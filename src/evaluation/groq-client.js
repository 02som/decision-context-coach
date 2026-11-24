/**
 * 답변 평가용 Groq Chat Completions 호출 (WBS 2.4·2.5 / DFAS-136, DFAS-137)
 *
 * 왜 fetch를 인자로 받나요?
 * - Forge에서는 외부 API를 api.fetch(@forge/api)로 호출해야 합니다.
 * - 이 모듈이 @forge/api를 직접 import하면 Forge 밖(일반 Node.js)에서 테스트할 수 없습니다.
 * - 그래서 resolver는 api.fetch를, 로컬 테스트는 가짜 fetch를, 실제 호출 스크립트는
 *   Node의 기본 fetch를 넘깁니다. 이것을 "의존성 주입"이라고 부릅니다.
 *
 * 이 모듈은 HTTP 호출과 응답 봉투(choices[0].message.content) 꺼내기만 합니다.
 * content 안의 평가 JSON 검증은 validation.js의 parseEvaluationOutput이 합니다.
 */

import { ERROR_CODES, EvaluationError } from './errors.js';

/** Groq의 OpenAI 호환 Chat Completions 엔드포인트입니다. manifest.yml에 api.groq.com이 허용되어 있습니다. */
export const GROQ_CHAT_COMPLETIONS_URL = 'https://api.groq.com/openai/v1/chat/completions';

/** analyzeIssue와 같은 모델을 씁니다. */
export const EVALUATION_MODEL = 'openai/gpt-oss-20b';

/**
 * 요청 설정입니다.
 * - temperature: 같은 답변에 비슷한 점수가 나오도록 낮게 둡니다.
 * - max_completion_tokens: gpt-oss는 추론(reasoning) 토큰도 이 한도에 포함되므로
 *   출력 JSON(수백 토큰)보다 넉넉하게 잡습니다. 너무 작으면 JSON이 잘려 INVALID_MODEL_OUTPUT이 됩니다.
 * - response_format json_object: Groq가 JSON 객체만 돌려주도록 강제합니다.
 */
export const EVALUATION_REQUEST_SETTINGS = Object.freeze({
  model: EVALUATION_MODEL,
  temperature: 0.2,
  max_completion_tokens: 2000,
  response_format: { type: 'json_object' }
});

/**
 * 기본 시간 제한(밀리초)입니다.
 * Forge resolver 함수는 기본 25초 안에 끝나야 합니다.
 * 형식 오류 시 1회 재시도까지 고려해 한 번의 호출은 10초로 제한합니다 (10초 × 2회 + Jira 조회).
 */
export const DEFAULT_TIMEOUT_MS = 10000;

/**
 * Promise에 시간 제한을 겁니다. 시간이 지나면 LLM_TIMEOUT 에러로 끝납니다.
 * 요청을 취소하는 AbortController 대신 Promise.race를 쓰는 이유:
 * Forge의 api.fetch가 signal 옵션을 지원하는지 보장할 수 없어서, 어디서나 동작하는 방법을 택했습니다.
 *
 * @template T
 * @param {Promise<T>} promise
 * @param {number} timeoutMs
 * @returns {Promise<T>}
 */
async function withTimeout(promise, timeoutMs) {
  let timer;

  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(new EvaluationError(ERROR_CODES.LLM_TIMEOUT, undefined, { timeoutMs }));
    }, timeoutMs);
  });

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    // 응답이 먼저 오면 타이머를 정리해 불필요한 대기를 남기지 않습니다.
    clearTimeout(timer);
  }
}

/**
 * 문자열을 JSON으로 파싱해 보고, 실패하면 null을 돌려줍니다.
 *
 * @param {string} text
 * @returns {any}
 */
function tryParseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * Groq에 평가 요청을 보내고, 모델이 생성한 content 문자열을 돌려줍니다.
 *
 * 오류 처리:
 * - 네트워크 오류, HTTP 오류(4xx/5xx) → LLM_REQUEST_FAILED (재시도하지 않음)
 * - 시간 초과 → LLM_TIMEOUT (재시도하지 않음)
 * - Groq가 JSON 모드에서 유효한 JSON을 만들지 못해 400 json_validate_failed를 돌려준 경우
 *   → INVALID_MODEL_OUTPUT (모델 출력 형식 문제이므로 재시도 대상)
 * - content가 비어 있음 → EMPTY_MODEL_OUTPUT (재시도 대상)
 *
 * 에러의 details에는 상태 코드와 Groq 에러 코드만 넣고, 응답 본문은 넣지 않습니다.
 *
 * @param {object} options
 * @param {(url: string, init: object) => Promise<{ ok: boolean, status: number, text: () => Promise<string> }>} options.fetchFn
 * @param {string} options.apiKey GROQ_API_KEY
 * @param {Array<{ role: string, content: string }>} options.messages buildEvaluationMessages()의 결과
 * @param {number} [options.timeoutMs]
 * @returns {Promise<string>} 모델이 생성한 content (평가 JSON 문자열)
 */
export async function requestEvaluationCompletion({
  fetchFn,
  apiKey,
  messages,
  timeoutMs = DEFAULT_TIMEOUT_MS
}) {
  if (!apiKey) {
    throw new EvaluationError(ERROR_CODES.CONFIGURATION_ERROR, undefined, {
      reason: 'GROQ_API_KEY is not set'
    });
  }

  // 요청 전송과 응답 본문 읽기를 함께 시간 제한 안에 넣습니다.
  // 본문을 읽는 단계에서 멈추는 경우도 시간 초과로 처리하기 위해서입니다.
  const sendRequest = async () => {
    const response = await fetchFn(GROQ_CHAT_COMPLETIONS_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ ...EVALUATION_REQUEST_SETTINGS, messages })
    });

    const rawBody = await response.text();
    return { response, rawBody };
  };

  let response;
  let rawBody;

  try {
    ({ response, rawBody } = await withTimeout(sendRequest(), timeoutMs));
  } catch (error) {
    if (error instanceof EvaluationError) {
      throw error;
    }

    // fetch 자체가 실패한 경우 (DNS, 연결 끊김 등)
    throw new EvaluationError(ERROR_CODES.LLM_REQUEST_FAILED, undefined, {
      reason: 'network error'
    });
  }

  const body = tryParseJson(rawBody);

  if (!response.ok) {
    const providerCode = body?.error?.code;

    // JSON 모드에서 모델이 JSON을 만들지 못한 경우: 모델 출력 문제로 보고 재시도 대상으로 분류합니다.
    if (response.status === 400 && providerCode === 'json_validate_failed') {
      throw new EvaluationError(ERROR_CODES.INVALID_MODEL_OUTPUT, undefined, {
        status: response.status,
        providerCode
      });
    }

    throw new EvaluationError(ERROR_CODES.LLM_REQUEST_FAILED, undefined, {
      status: response.status,
      providerCode: typeof providerCode === 'string' ? providerCode : undefined
    });
  }

  if (!body) {
    throw new EvaluationError(ERROR_CODES.LLM_REQUEST_FAILED, undefined, {
      reason: 'response body is not JSON'
    });
  }

  const choice = body.choices?.[0];
  const content = choice?.message?.content;

  if (typeof content !== 'string' || !content.trim()) {
    throw new EvaluationError(ERROR_CODES.EMPTY_MODEL_OUTPUT, undefined, {
      // finish_reason이 "length"면 토큰 한도 때문에 출력이 잘린 것입니다.
      finishReason: choice?.finish_reason
    });
  }

  return content;
}
