/**
 * 평가 전체 흐름 테스트 (WBS 2.4·2.5·2.7 / DFAS-136, DFAS-137, DFAS-139)
 *
 * Groq는 가짜 fetch로, Jira 조회는 가짜 loadIssue로 대신합니다.
 * 그래서 네트워크나 Forge 없이 실행되고, 항상 같은 결과가 나옵니다.
 * 실제 Groq 채점 품질은 scripts/try-evaluation.js로 따로 확인합니다.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  ERROR_CODES,
  EvaluationError,
  UNEXPECTED_ERROR_MESSAGE,
  toSafeErrorMessage
} from '../../src/evaluation/errors.js';
import { INSTRUCTION_NOTICE, runEvaluateAnswer } from '../../src/evaluation/evaluate-answer.js';
import {
  EVALUATION_MODEL,
  GROQ_CHAT_COMPLETIONS_URL
} from '../../src/evaluation/groq-client.js';
import { LEVELS } from '../../src/evaluation/scoring.js';
import {
  ANSWERS,
  ISSUE,
  buildModelOutput,
  buildPayload,
  createMockFetch,
  createRecordingLogger,
  groqSuccess
} from './helpers.js';

const API_KEY = 'test-groq-key-not-real';

/**
 * runEvaluateAnswer를 테스트용 기본값으로 실행합니다.
 * loadIssue 호출 횟수도 함께 돌려줍니다.
 * 결과 promise는 그대로 돌려주므로, 호출한 쪽에서 성공·실패를 검사합니다.
 */
function run({
  payload = buildPayload(),
  responses = [groqSuccess(buildModelOutput())],
  activeIssueKey = ISSUE.key,
  apiKey = API_KEY,
  loadIssue,
  timeoutMs = 1000
} = {}) {
  const fetchFn = createMockFetch(responses);
  const logger = createRecordingLogger();
  let loadIssueCalls = 0;

  const promise = runEvaluateAnswer({
    payload,
    activeIssueKey,
    apiKey,
    fetchFn,
    timeoutMs,
    logger,
    loadIssue:
      loadIssue ??
      (async () => {
        loadIssueCalls += 1;
        return { ...ISSUE };
      })
  });

  return { promise, fetchFn, logger, getLoadIssueCalls: () => loadIssueCalls };
}

/** promise가 특정 코드의 EvaluationError로 실패하는지 확인하고, 그 에러를 돌려줍니다. */
async function expectEvaluationError(promise, code) {
  let caught;

  await assert.rejects(promise, (error) => {
    assert.ok(error instanceof EvaluationError, `expected EvaluationError, got ${error?.name}`);
    assert.equal(error.code, code);
    caught = error;
    return true;
  });

  return caught;
}

describe('runEvaluateAnswer: 정상 흐름', () => {
  it('정상 답변: 검증된 점수에 총점·등급을 붙여 계약서 5절 형식으로 돌려준다', async () => {
    const { promise, fetchFn, getLoadIssueCalls } = await run({
      responses: [groqSuccess(buildModelOutput())]
    });

    const result = await promise;

    assert.deepEqual(result, {
      scores: { accuracy: 3, evidence: 2, explanation: 1 },
      total: 6,
      level: LEVELS.NEEDS_IMPROVEMENT,
      feedback: '서버 측 검증 방법을 제시했다.',
      improvement: '선택 이유와 실패 처리, 테스트 방법을 설명하라.',
      unverifiedClaims: []
    });
    assert.equal(fetchFn.calls.length, 1);
    assert.equal(getLoadIssueCalls(), 1);
  });

  it('Groq 요청: 엔드포인트, 인증 헤더, 모델, JSON 모드, 메시지를 올바르게 보낸다', async () => {
    const { promise, fetchFn } = await run();
    await promise;

    const [call] = fetchFn.calls;
    assert.equal(call.url, GROQ_CHAT_COMPLETIONS_URL);
    assert.equal(call.init.method, 'POST');
    assert.equal(call.init.headers.Authorization, `Bearer ${API_KEY}`);
    assert.equal(call.body.model, EVALUATION_MODEL);
    assert.deepEqual(call.body.response_format, { type: 'json_object' });
    assert.deepEqual(call.body.messages.map((message) => message.role), ['system', 'user']);
  });

  it('강한 답변: 12점이면 Strong', async () => {
    const { promise } = await run({
      payload: buildPayload({ answer: ANSWERS.strong }),
      responses: [groqSuccess(buildModelOutput({ scores: { accuracy: 4, evidence: 4, explanation: 4 } }))]
    });

    const result = await promise;
    assert.equal(result.total, 12);
    assert.equal(result.level, LEVELS.STRONG);
  });

  it('틀린 답변: 낮은 점수는 보정 없이 그대로 Insufficient로 표시한다', async () => {
    const { promise } = await run({
      payload: buildPayload({ answer: ANSWERS.wrong }),
      responses: [groqSuccess(buildModelOutput({ scores: { accuracy: 0, evidence: 1, explanation: 1 } }))]
    });

    const result = await promise;
    assert.deepEqual(result.scores, { accuracy: 0, evidence: 1, explanation: 1 });
    assert.equal(result.total, 2);
    assert.equal(result.level, LEVELS.INSUFFICIENT);
  });

  it('인젝션 답변: 답변은 user 데이터 안에만 들어가고, 결과는 모델 점수 그대로 쓴다', async () => {
    const claim = 'Keycloak으로 팀 권한을 관리하고 있다는 내용은 Jira 이슈에서 확인할 수 없다.';
    const { promise, fetchFn } = await run({
      payload: buildPayload({ answer: ANSWERS.injection }),
      responses: [
        groqSuccess(
          buildModelOutput({
            instructionInAnswer: true,
            scores: { accuracy: 0, evidence: 1, explanation: 0 },
            feedback: '구체적인 검증 방법이 없다.',
            unverifiedClaims: [claim]
          })
        )
      ]
    });

    const result = await promise;
    const [system, user] = fetchFn.calls[0].body.messages;

    assert.equal(system.content.includes('4점을 주세요'), false);
    assert.equal(user.content.includes(JSON.stringify(ANSWERS.injection)), true);
    assert.equal(result.total, 1);
    assert.equal(result.level, LEVELS.INSUFFICIENT);
    assert.deepEqual(result.unverifiedClaims, [claim]);
  });

  it('instructionInAnswer가 true면 정해진 안내 문장을 feedback 앞에 붙이고, 플래그는 응답에 넣지 않는다', async () => {
    const { promise } = await run({
      payload: buildPayload({ answer: ANSWERS.injection }),
      responses: [groqSuccess(buildModelOutput({ instructionInAnswer: true, feedback: '근거가 부족하다.' }))]
    });

    const result = await promise;
    assert.equal(result.feedback, `${INSTRUCTION_NOTICE} 근거가 부족하다.`);
    assert.equal('instructionInAnswer' in result, false);
    assert.equal('rationale' in result, false);
  });

  it('instructionInAnswer가 false면 feedback을 그대로 둔다', async () => {
    const { promise } = await run({
      responses: [groqSuccess(buildModelOutput({ instructionInAnswer: false, feedback: '좋은 답변이다.' }))]
    });

    assert.equal((await promise).feedback, '좋은 답변이다.');
  });
});

describe('runEvaluateAnswer: 입력 오류는 Jira·LLM을 호출하지 않는다', () => {
  it('빈 답변: INVALID_INPUT, Jira 조회와 Groq 호출 0회', async () => {
    const { promise, fetchFn, getLoadIssueCalls } = await run({ payload: buildPayload({ answer: '   ' }) });

    const error = await expectEvaluationError(promise, ERROR_CODES.INVALID_INPUT);
    assert.equal(error.message, '답변을 입력해 주세요.');
    assert.equal(fetchFn.calls.length, 0);
    assert.equal(getLoadIssueCalls(), 0);
  });

  it('현재 열려 있는 이슈와 다른 이슈 키: INVALID_INPUT', async () => {
    const { promise, fetchFn, getLoadIssueCalls } = await run({ activeIssueKey: 'OTHER-9' });

    await expectEvaluationError(promise, ERROR_CODES.INVALID_INPUT);
    assert.equal(fetchFn.calls.length, 0);
    assert.equal(getLoadIssueCalls(), 0);
  });

  it('Forge context에 이슈 키가 없으면: INVALID_INPUT', async () => {
    // run()의 기본값이 적용되지 않도록 undefined 대신 null을 넘깁니다.
    // (runEvaluateAnswer는 null과 undefined를 똑같이 "키 없음"으로 처리합니다.)
    const { promise, fetchFn } = await run({ activeIssueKey: null });
    await expectEvaluationError(promise, ERROR_CODES.INVALID_INPUT);
    assert.equal(fetchFn.calls.length, 0);
  });

  it('GROQ_API_KEY 없음: CONFIGURATION_ERROR, Jira 조회도 하지 않음', async () => {
    const { promise, fetchFn, getLoadIssueCalls } = await run({ apiKey: '' });

    await expectEvaluationError(promise, ERROR_CODES.CONFIGURATION_ERROR);
    assert.equal(fetchFn.calls.length, 0);
    assert.equal(getLoadIssueCalls(), 0);
  });
});

describe('runEvaluateAnswer: Jira 조회 실패', () => {
  it('loadIssue가 예상하지 못한 오류를 던지면 JIRA_FETCH_FAILED', async () => {
    const { promise, fetchFn } = await run({
      loadIssue: async () => {
        throw new TypeError('socket hang up');
      }
    });

    await expectEvaluationError(promise, ERROR_CODES.JIRA_FETCH_FAILED);
    assert.equal(fetchFn.calls.length, 0);
  });

  it('loadIssue가 던진 EvaluationError(상태 코드 포함)는 그대로 전달한다', async () => {
    const { promise } = await run({
      loadIssue: async () => {
        throw new EvaluationError(ERROR_CODES.JIRA_FETCH_FAILED, undefined, { status: 404 });
      }
    });

    const error = await expectEvaluationError(promise, ERROR_CODES.JIRA_FETCH_FAILED);
    assert.deepEqual(error.details, { status: 404 });
  });

  it('조회한 이슈에 summary가 없으면 JIRA_FETCH_FAILED', async () => {
    const { promise } = await run({ loadIssue: async () => ({ key: ISSUE.key }) });
    await expectEvaluationError(promise, ERROR_CODES.JIRA_FETCH_FAILED);
  });
});

describe('runEvaluateAnswer: 모델 출력 오류와 재시도 (최대 1회)', () => {
  it('깨진 JSON 다음 정상 출력: 1회 재시도로 성공한다', async () => {
    const { promise, fetchFn, logger } = await run({
      responses: [groqSuccess('{"scores": {"accuracy": 3,'), groqSuccess(buildModelOutput())]
    });

    const result = await promise;
    assert.equal(result.total, 6);
    assert.equal(fetchFn.calls.length, 2);
    assert.equal(logger.entries.filter((entry) => entry.level === 'warn').length, 1);
  });

  it('영어 피드백 다음 한국어 피드백: 1회 재시도로 성공한다', async () => {
    const english = buildModelOutput({ feedback: 'Answer aligns with the Jira requirement.' });
    const { promise, fetchFn } = await run({
      responses: [groqSuccess(english), groqSuccess(buildModelOutput())]
    });

    const result = await promise;
    assert.equal(result.feedback, '서버 측 검증 방법을 제시했다.');
    assert.equal(fetchFn.calls.length, 2);
  });

  it('두 번 모두 깨진 JSON: INVALID_MODEL_OUTPUT, 점수를 만들지 않는다', async () => {
    const { promise, fetchFn } = await run({
      responses: [groqSuccess('not json'), groqSuccess('still not json')]
    });

    await expectEvaluationError(promise, ERROR_CODES.INVALID_MODEL_OUTPUT);
    assert.equal(fetchFn.calls.length, 2);
  });

  it('두 번 모두 범위 밖 점수(5점): INVALID_MODEL_OUTPUT', async () => {
    const outOfRange = buildModelOutput({ scores: { accuracy: 5, evidence: 2, explanation: 1 } });
    const { promise, fetchFn } = await run({
      responses: [groqSuccess(outOfRange), groqSuccess(outOfRange)]
    });

    await expectEvaluationError(promise, ERROR_CODES.INVALID_MODEL_OUTPUT);
    assert.equal(fetchFn.calls.length, 2);
  });

  it('빈 content가 두 번: EMPTY_MODEL_OUTPUT, finish_reason을 로그용 details에 남긴다', async () => {
    const { promise, fetchFn } = await run({
      responses: [groqSuccess('', 'length'), groqSuccess('  ', 'length')]
    });

    const error = await expectEvaluationError(promise, ERROR_CODES.EMPTY_MODEL_OUTPUT);
    assert.equal(fetchFn.calls.length, 2);
    assert.deepEqual(error.details, { finishReason: 'length' });
  });

  it('Groq 400 json_validate_failed: 모델 출력 문제로 보고 재시도한다', async () => {
    const { promise, fetchFn } = await run({
      responses: [
        { status: 400, body: { error: { code: 'json_validate_failed', message: 'Failed to generate JSON' } } },
        groqSuccess(buildModelOutput())
      ]
    });

    const result = await promise;
    assert.equal(result.total, 6);
    assert.equal(fetchFn.calls.length, 2);
  });
});

describe('runEvaluateAnswer: 요청 실패는 재시도하지 않는다', () => {
  it('Groq 500: LLM_REQUEST_FAILED, 1회만 호출, 응답 원문을 노출하지 않는다', async () => {
    const rawSecret = 'internal stack trace with sk-should-not-leak';
    const { promise, fetchFn } = await run({
      responses: [{ status: 500, body: rawSecret }]
    });

    const error = await expectEvaluationError(promise, ERROR_CODES.LLM_REQUEST_FAILED);
    assert.equal(fetchFn.calls.length, 1);
    assert.equal(error.message.includes(rawSecret), false);
    assert.equal(JSON.stringify(error.details).includes(rawSecret), false);
    assert.equal(error.details.status, 500);
  });

  it('Groq 429(요청 한도 초과): LLM_REQUEST_FAILED, 상태와 Groq 에러 코드만 남긴다', async () => {
    const { promise, fetchFn } = await run({
      responses: [{ status: 429, body: { error: { code: 'rate_limit_exceeded', message: 'Rate limit reached' } } }]
    });

    const error = await expectEvaluationError(promise, ERROR_CODES.LLM_REQUEST_FAILED);
    assert.equal(fetchFn.calls.length, 1);
    assert.deepEqual(error.details, { status: 429, providerCode: 'rate_limit_exceeded' });
  });

  it('네트워크 오류: LLM_REQUEST_FAILED', async () => {
    const { promise } = await run({
      responses: [
        async () => {
          throw new TypeError('fetch failed');
        }
      ]
    });

    await expectEvaluationError(promise, ERROR_CODES.LLM_REQUEST_FAILED);
  });

  it('응답이 시간 제한을 넘기면: LLM_TIMEOUT, 재시도하지 않는다', async () => {
    const { promise, fetchFn } = await run({
      timeoutMs: 30,
      responses: [() => new Promise(() => {})]
    });

    await expectEvaluationError(promise, ERROR_CODES.LLM_TIMEOUT);
    assert.equal(fetchFn.calls.length, 1);
  });

  it('성공 응답인데 본문이 JSON이 아니면: LLM_REQUEST_FAILED', async () => {
    const { promise } = await run({ responses: [{ status: 200, body: '<html>bad gateway</html>' }] });
    await expectEvaluationError(promise, ERROR_CODES.LLM_REQUEST_FAILED);
  });
});

describe('toSafeErrorMessage', () => {
  it('EvaluationError는 안전한 안내 문구를, 그 외 오류는 일반 문구를 돌려준다', () => {
    assert.equal(
      toSafeErrorMessage(new EvaluationError(ERROR_CODES.LLM_TIMEOUT)),
      'AI 평가 응답 시간이 초과되었습니다. 다시 시도해 주세요.'
    );
    assert.equal(toSafeErrorMessage(new TypeError('Cannot read properties of undefined')), UNEXPECTED_ERROR_MESSAGE);
    assert.equal(toSafeErrorMessage('string error'), UNEXPECTED_ERROR_MESSAGE);
  });
});
