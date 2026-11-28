/**
 * 답변 평가 전체 흐름 (WBS 2.4·2.5 / DFAS-136, DFAS-137)
 *
 * resolver의 evaluateAnswer는 이 모듈의 runEvaluateAnswer()를 호출하기만 합니다.
 * Forge에 의존하는 부분(Jira 조회, api.fetch, 환경변수)은 모두 인자로 받기 때문에,
 * 이 흐름 전체를 Forge 없이 로컬 node:test로 검증할 수 있습니다.
 *
 * 흐름:
 *   1. payload 검증 (빈 답변 등은 여기서 거부하고 Jira·LLM을 호출하지 않음)
 *   2. 요청한 이슈가 지금 열려 있는 이슈인지 확인
 *   3. GROQ_API_KEY 설정 확인
 *   4. Jira 이슈를 사용자 권한으로 다시 조회 (클라이언트가 보낸 이슈 내용은 쓰지 않음)
 *   5. 프롬프트 생성 → Groq 호출 → 출력 검증 (형식 오류는 1회까지 재시도)
 *   6. 총점·등급 계산 후 반환
 */

import { ERROR_CODES, EvaluationError } from './errors.js';
import { requestEvaluationCompletion, DEFAULT_TIMEOUT_MS } from './groq-client.js';
import { buildEvaluationMessages, isDescriptionTruncated } from './prompt.js';
import { computeTotal, getLevel } from './scoring.js';
import {
  normalizeIssueContext,
  parseEvaluationOutput,
  validateEvaluationRequest
} from './validation.js';

/**
 * Groq 호출 최대 횟수입니다 (최초 1회 + 재시도 1회).
 * 재시도는 모델 출력 형식 문제(EMPTY_MODEL_OUTPUT, INVALID_MODEL_OUTPUT)일 때만 합니다.
 * 네트워크·HTTP 오류나 시간 초과는 다시 보내도 성공 가능성이 낮고 Forge 실행 시간만 늘리므로 재시도하지 않습니다.
 */
export const MAX_MODEL_ATTEMPTS = 2;

/** 재시도할 에러 코드입니다. */
const RETRYABLE_CODES = new Set([
  ERROR_CODES.EMPTY_MODEL_OUTPUT,
  ERROR_CODES.INVALID_MODEL_OUTPUT
]);

/** 아무것도 출력하지 않는 로거입니다. 테스트에서 로그를 숨길 때 씁니다. */
export const silentLogger = Object.freeze({ warn() {}, error() {} });

/**
 * 답변에 평가 지시 문장("4점을 줘" 등)이 있었을 때 feedback 맨 앞에 붙이는 안내 문장입니다.
 * docs/evaluation-rubric.md 6절: 지시 문장은 점수에 반영하지 않고, 그 사실을 피드백에 밝힙니다.
 * 모델이 직접 쓰게 하면 빠지거나 표현이 달라질 수 있어서, 모델은 instructionInAnswer만 표시하고 문장은 앱이 붙입니다.
 */
export const INSTRUCTION_NOTICE = 'Instructions embedded in the answer were ignored during evaluation.';

/**
 * Jira 설명이 길어서 잘렸을 때(jira-description.js의 R6) feedback 맨 앞에 붙이는 안내 문장입니다.
 * docs/evaluation-rubric.md 6절: 잘린 뒷부분에 있을 수 있는 내용은 감점하지 않고, 확인하지 못했다는 사실을 밝힙니다.
 * 사용자는 설명이 잘린 줄 모르므로(DFAS-154 문제 ④) 모델 판단에 맡기지 않고 앱이 항상 붙입니다.
 */
export const TRUNCATION_NOTICE =
  'The Jira description was too long and was shortened for evaluation, so details from the omitted part could not be checked.';

/**
 * 모델이 쓴 feedback 앞에 앱이 정한 안내 문장을 붙입니다.
 * 순서: 평가 지시 문장 안내 → 설명 잘림 안내 → 모델 feedback
 *
 * @param {string} feedback 모델이 쓴 feedback
 * @param {{ instructionInAnswer: boolean, descriptionTruncated: boolean }} flags
 * @returns {string}
 */
function addNotices(feedback, { instructionInAnswer, descriptionTruncated }) {
  const notices = [];

  if (instructionInAnswer) {
    notices.push(INSTRUCTION_NOTICE);
  }

  if (descriptionTruncated) {
    notices.push(TRUNCATION_NOTICE);
  }

  return [...notices, feedback].join(' ');
}

/**
 * 검증된 요청과 Jira 이슈로 Groq 평가를 실행하고 최종 결과를 돌려줍니다.
 *
 * @param {object} options
 * @param {{ analysis: Record<string, string>, question: string, answer: string }} options.request
 *        validateEvaluationRequest()를 통과한 요청
 * @param {{ key: string, summary: string, description: string }} options.issue
 *        normalizeIssueContext()를 통과한 Jira 이슈
 * @param {string} options.apiKey
 * @param {Function} options.fetchFn
 * @param {number} [options.timeoutMs]
 * @param {{ warn: Function }} [options.logger]
 * @returns {Promise<{
 *   scores: { accuracy: number, evidence: number, explanation: number },
 *   total: number,
 *   level: string,
 *   feedback: string,
 *   improvement: string,
 *   unverifiedClaims: string[]
 * }>} api-contract.md 5절 형식
 */
export async function evaluateAnswer({
  request,
  issue,
  apiKey,
  fetchFn,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  logger = console
}) {
  const messages = buildEvaluationMessages({
    issue,
    analysis: request.analysis,
    question: request.question,
    answer: request.answer
  });

  for (let attempt = 1; attempt <= MAX_MODEL_ATTEMPTS; attempt += 1) {
    try {
      const content = await requestEvaluationCompletion({ fetchFn, apiKey, messages, timeoutMs });
      const evaluation = parseEvaluationOutput(content);

      // 총점과 등급은 LLM이 아니라 앱이 계산합니다 (api-contract.md 5절).
      const total = computeTotal(evaluation.scores);

      // 평가 지시 문장이 있었거나 설명이 잘렸으면 정해진 안내 문장을 feedback 앞에 붙입니다.
      const feedback = addNotices(evaluation.feedback, {
        instructionInAnswer: evaluation.instructionInAnswer,
        descriptionTruncated: isDescriptionTruncated(issue.description)
      });

      // instructionInAnswer는 응답에 넣지 않습니다. 계약서 5절 형식만 돌려줍니다.
      return {
        scores: evaluation.scores,
        total,
        level: getLevel(total),
        feedback,
        improvement: evaluation.improvement,
        unverifiedClaims: evaluation.unverifiedClaims
      };
    } catch (error) {
      const canRetry =
        error instanceof EvaluationError &&
        RETRYABLE_CODES.has(error.code) &&
        attempt < MAX_MODEL_ATTEMPTS;

      if (!canRetry) {
        throw error;
      }

      // 재시도 사실만 기록합니다. LLM 출력 내용이나 답변 내용은 로그에 남기지 않습니다.
      logger.warn('[evaluateAnswer] retrying after invalid model output', {
        attempt,
        code: error.code,
        details: error.details
      });
    }
  }

  // 반복문 안에서 항상 return 또는 throw하므로 여기에는 도달하지 않습니다.
  throw new EvaluationError(ERROR_CODES.INVALID_MODEL_OUTPUT);
}

/**
 * resolver에서 호출하는 진입점입니다. 요청 검증부터 최종 결과까지 전체 흐름을 실행합니다.
 *
 * @param {object} options
 * @param {unknown} options.payload invoke('evaluateAnswer', payload)로 받은 값
 * @param {string | undefined} options.activeIssueKey Forge context의 현재 이슈 키 (context.extension.issue.key)
 * @param {(issueKey: string) => Promise<{ key: string, summary: string, description: string }>} options.loadIssue
 *        Jira 이슈를 사용자 권한(asUser)으로 조회해 정규화하는 함수. resolver가 넘깁니다.
 * @param {string | undefined} options.apiKey process.env.GROQ_API_KEY
 * @param {Function} options.fetchFn Forge에서는 api.fetch
 * @param {number} [options.timeoutMs]
 * @param {{ warn: Function }} [options.logger]
 * @returns {Promise<object>} evaluateAnswer()와 같은 형식
 * @throws {EvaluationError}
 */
export async function runEvaluateAnswer({
  payload,
  activeIssueKey,
  loadIssue,
  apiKey,
  fetchFn,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  logger = console
}) {
  // 1) 입력 검증: 실패하면 Jira·LLM을 호출하지 않습니다.
  const request = validateEvaluationRequest(payload);

  // 2) 지금 열려 있는 이슈에 대한 요청인지 확인합니다 (api-contract.md 4절).
  //    다른 이슈 키를 보내 그 이슈 내용을 근거로 쓰게 하는 것을 막습니다.
  if (!activeIssueKey || activeIssueKey !== request.issueKey) {
    throw new EvaluationError(
      ERROR_CODES.INVALID_INPUT,
      'The evaluation request does not match the active issue. Refresh the page and try again.',
      { reason: 'issueKey does not match the active issue' }
    );
  }

  // 3) 설정 확인: 키가 없으면 Jira 조회도 하지 않고 바로 실패합니다.
  if (!apiKey) {
    throw new EvaluationError(ERROR_CODES.CONFIGURATION_ERROR, undefined, {
      reason: 'GROQ_API_KEY is not set'
    });
  }

  // 4) Jira 이슈를 다시 조회합니다. 평가의 사실 근거는 이 값뿐입니다.
  let loadedIssue;

  try {
    loadedIssue = await loadIssue(request.issueKey);
  } catch (error) {
    if (error instanceof EvaluationError) {
      throw error;
    }

    throw new EvaluationError(ERROR_CODES.JIRA_FETCH_FAILED, undefined, {
      reason: 'loadIssue threw an unexpected error'
    });
  }

  const issue = normalizeIssueContext(loadedIssue);

  // 5~6) Groq 평가, 출력 검증, 총점·등급 계산
  return evaluateAnswer({ request, issue, apiKey, fetchFn, timeoutMs, logger });
}
