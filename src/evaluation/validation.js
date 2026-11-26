/**
 * 평가 요청 검증과 LLM 출력 검증 (WBS 2.4·2.5 / DFAS-136, DFAS-137)
 *
 * 이 모듈은 두 가지 "경계"를 지킵니다.
 * 1. 프론트엔드 → resolver: 클라이언트가 보낸 payload는 신뢰하지 않고 형식을 검사합니다.
 *    빈 답변처럼 LLM을 부를 필요가 없는 요청은 여기서 바로 거부합니다.
 * 2. Groq → resolver: LLM 출력도 신뢰하지 않습니다. 점수 범위와 필드 형식을 검사하고,
 *    형식이 틀리면 점수를 지어내지 않고 INVALID_MODEL_OUTPUT으로 실패시킵니다.
 *
 * 기준 문서: docs/api-contract.md 4~6절, docs/evaluation-rubric.md 5·7절
 */

import { ERROR_CODES, EvaluationError } from './errors.js';
import { SCORE_KEYS, isValidScore } from './scoring.js';

/** 답변 최대 길이입니다. 너무 긴 입력으로 토큰 비용이 커지거나 요청이 실패하는 것을 막습니다. */
export const MAX_ANSWER_LENGTH = 4000;

/** analysis 각 필드의 최대 길이입니다. 정상적인 analyzeIssue 결과는 이보다 훨씬 짧습니다. */
export const MAX_ANALYSIS_FIELD_LENGTH = 4000;

/** analysis 객체에 반드시 있어야 하는 필드입니다 (api-contract.md 3절). */
export const ANALYSIS_FIELDS = Object.freeze([
  'decision',
  'risk',
  'technicalConsiderations',
  'missingInformation',
  'question'
]);

/**
 * Jira 이슈 키 형식입니다. 예: DFAS-142, FLOW-1
 * 프로젝트 키(영문으로 시작, 영문·숫자·밑줄) + 하이픈 + 숫자
 */
const ISSUE_KEY_PATTERN = /^[A-Za-z][A-Za-z0-9_]*-\d+$/;

/**
 * 일반 객체(배열·null이 아닌 {})인지 확인합니다.
 *
 * @param {unknown} value
 * @returns {boolean}
 */
function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * 값이 비어 있지 않은 문자열이면 앞뒤 공백을 제거해 돌려주고, 아니면 null을 돌려줍니다.
 *
 * @param {unknown} value
 * @returns {string | null}
 */
function toNonEmptyString(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * INVALID_INPUT 에러를 만드는 짧은 도우미입니다.
 *
 * @param {string} message 사용자에게 보여 줄 문구
 * @param {string} reason 로그용 이유 (사용자 입력 내용은 넣지 않음)
 */
function invalidInput(message, reason) {
  return new EvaluationError(ERROR_CODES.INVALID_INPUT, message, { reason });
}

/**
 * 프론트엔드가 보낸 evaluateAnswer payload를 검증하고, 공백을 정리한 새 객체를 돌려줍니다.
 *
 * 검사 순서:
 * 1. payload 형식
 * 2. 답변: 사용자가 가장 자주 겪는 오류라서 먼저 검사합니다.
 * 3. 이슈 키
 * 4. analysis 필드
 * 5. question과 analysis.question 일치
 *
 * @param {unknown} payload invoke('evaluateAnswer', payload)로 받은 값
 * @returns {{ issueKey: string, analysis: Record<string, string>, question: string, answer: string }}
 * @throws {EvaluationError} INVALID_INPUT
 */
export function validateEvaluationRequest(payload) {
  if (!isPlainObject(payload)) {
    throw invalidInput(undefined, 'payload is not an object');
  }

  // 1) 답변: 비어 있거나 공백뿐이면 LLM을 호출하지 않고 거부합니다.
  const answer = toNonEmptyString(payload.answer);

  if (!answer) {
    throw invalidInput('Please enter your answer.', 'answer is empty');
  }

  if (answer.length > MAX_ANSWER_LENGTH) {
    throw invalidInput(
      `답변은 ${MAX_ANSWER_LENGTH}자 이하로 입력해 주세요.`,
      'answer is too long'
    );
  }

  // 2) 이슈 키
  const issueKey = toNonEmptyString(payload.issueKey);

  if (!issueKey || !ISSUE_KEY_PATTERN.test(issueKey)) {
    throw invalidInput(undefined, 'issueKey is missing or malformed');
  }

  // 3) analysis: analyzeIssue가 돌려준 5개 필드가 모두 있어야 합니다.
  if (!isPlainObject(payload.analysis)) {
    throw invalidInput(undefined, 'analysis is not an object');
  }

  const analysis = {};

  for (const field of ANALYSIS_FIELDS) {
    const value = toNonEmptyString(payload.analysis[field]);

    if (!value || value.length > MAX_ANALYSIS_FIELD_LENGTH) {
      throw invalidInput(undefined, `analysis.${field} is missing or too long`);
    }

    analysis[field] = value;
  }

  // 4) question은 analysis.question과 같아야 합니다 (api-contract.md 4절).
  //    다른 질문을 끼워 넣어 평가 기준을 바꾸는 것을 막습니다.
  const question = toNonEmptyString(payload.question);

  if (!question || question !== analysis.question) {
    throw invalidInput(
      'The question does not match the analysis. Analyze the issue again and retry.',
      'question does not match analysis.question'
    );
  }

  return { issueKey, analysis, question, answer };
}

/**
 * resolver가 Jira에서 다시 조회한 이슈를 검증하고 정규화합니다 (api-contract.md 2절).
 * key와 summary가 없으면 평가 근거가 없으므로 실패시킵니다. description은 비어 있어도 됩니다.
 *
 * @param {unknown} issue loadIssue()가 돌려준 값
 * @returns {{ key: string, summary: string, description: string }}
 * @throws {EvaluationError} JIRA_FETCH_FAILED
 */
export function normalizeIssueContext(issue) {
  const key = toNonEmptyString(issue?.key);
  const summary = toNonEmptyString(issue?.summary);

  if (!key || !summary) {
    throw new EvaluationError(ERROR_CODES.JIRA_FETCH_FAILED, undefined, {
      reason: 'issue key or summary is missing'
    });
  }

  const description = typeof issue.description === 'string' ? issue.description.trim() : '';

  return { key, summary, description };
}

/**
 * 문장이 주로 한국어로 쓰였는지 확인합니다.
 *
 * 사용자 화면과 Jira 댓글은 한국어이므로, 모델이 영어로 쓴 피드백은 형식 오류로 보고 재시도합니다.
 * 기술 용어(JWT, API, Redis 등)는 영어로 섞여도 되도록, 한글 음절 수가 영문 글자 수의 1/3 이상이면 통과시킵니다.
 * - "서버에서 JWT 토큰을 검증합니다." → 한글 11, 영문 3 → 통과
 * - "Answer aligns with the Jira requirement for 권한 검증." → 한글 4, 영문 약 35 → 실패
 *
 * @param {string} text
 * @returns {boolean}
 */
export function isMostlyEnglish(text) {
  const hangulCount = (text.match(/[가-힣]/g) || []).length;
  const latinCount = (text.match(/[A-Za-z]/g) || []).length;

  return latinCount > 0 && latinCount > hangulCount * 3;
}

/**
 * INVALID_MODEL_OUTPUT 에러를 만드는 짧은 도우미입니다.
 * reason에는 어떤 검사에서 실패했는지만 적고, LLM 출력 내용은 넣지 않습니다.
 *
 * @param {string} reason
 */
function invalidOutput(reason) {
  return new EvaluationError(ERROR_CODES.INVALID_MODEL_OUTPUT, undefined, { reason });
}

/**
 * Groq가 돌려준 message.content(문자열)를 파싱하고 검증합니다.
 *
 * 통과 조건 (api-contract.md 5절):
 * - JSON 객체 하나
 * - scores.accuracy / evidence / explanation: 모두 0~4 정수
 * - feedback, improvement: 비어 있지 않은 문자열
 * - unverifiedClaims: 문자열 배열 (빈 배열 가능)
 *
 * 그 밖의 필드:
 * - rationale(점수 근거): 채점 정확도를 높이려고 모델에게 쓰게 하는 필드입니다. 화면에 보여 주지 않으므로 버립니다.
 * - instructionInAnswer: 답변에 평가 지시 문장이 있었는지 나타냅니다. 정확히 true일 때만 true로 보고,
 *   없거나 다른 값이면 false로 봅니다. 이 값만으로 점수가 바뀌지는 않습니다.
 * - 정의되지 않은 필드(예: LLM이 임의로 넣은 total)는 결과에 포함하지 않고 버립니다.
 * 총점과 등급은 이 함수 밖에서 앱이 계산합니다.
 *
 * @param {string} content
 * @returns {{ scores: { accuracy: number, evidence: number, explanation: number }, feedback: string, improvement: string, unverifiedClaims: string[], instructionInAnswer: boolean }}
 * @throws {EvaluationError} INVALID_MODEL_OUTPUT
 */
export function parseEvaluationOutput(content) {
  let parsed;

  try {
    parsed = JSON.parse(content);
  } catch {
    throw invalidOutput('content is not valid JSON');
  }

  if (!isPlainObject(parsed)) {
    throw invalidOutput('content is not a JSON object');
  }

  // scores: 세 항목 모두 0~4 정수여야 합니다. 하나라도 틀리면 점수를 보정하지 않고 실패시킵니다.
  if (!isPlainObject(parsed.scores)) {
    throw invalidOutput('scores is not an object');
  }

  const scores = {};

  for (const key of SCORE_KEYS) {
    if (!isValidScore(parsed.scores[key])) {
      throw invalidOutput(`scores.${key} is not an integer between 0 and 4`);
    }

    scores[key] = parsed.scores[key];
  }

  const feedback = toNonEmptyString(parsed.feedback);
  const improvement = toNonEmptyString(parsed.improvement);

  if (!feedback) {
    throw invalidOutput('feedback is empty');
  }

  if (!improvement) {
    throw invalidOutput('improvement is empty');
  }

  // 화면과 Jira 댓글에 그대로 나가는 문장이므로 한국어여야 합니다. 영어면 재시도 대상이 됩니다.
  if (!isMostlyEnglish(feedback)) {
    throw invalidOutput('feedback is not written in English');
  }

  if (!isMostlyEnglish(improvement)) {
    throw invalidOutput('improvement is not written in English');
  }

  // unverifiedClaims: 문자열 배열이어야 합니다.
  // 빈 문자열 항목은 의미가 없으므로 버리고, 문자열이 아닌 항목이 있으면 실패시킵니다.
  if (!Array.isArray(parsed.unverifiedClaims)) {
    throw invalidOutput('unverifiedClaims is not an array');
  }

  const unverifiedClaims = [];

  for (const claim of parsed.unverifiedClaims) {
    if (typeof claim !== 'string') {
      throw invalidOutput('unverifiedClaims contains a non-string item');
    }

    const trimmed = claim.trim();

    if (trimmed) {
      unverifiedClaims.push(trimmed);
    }
  }

  const instructionInAnswer = parsed.instructionInAnswer === true;

  return { scores, feedback, improvement, unverifiedClaims, instructionInAnswer };
}
