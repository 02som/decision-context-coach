/**
 * 답변 평가에서 쓰는 에러 코드와 에러 클래스 (WBS 2.4·2.5 / DFAS-136, DFAS-137)
 *
 * 에러 코드는 docs/api-contract.md 6절을 따릅니다.
 *
 * 왜 별도의 에러 클래스가 필요한가요?
 * - Forge의 invoke()는 resolver가 throw한 Error의 "message"만 프론트엔드에 전달합니다.
 *   code 같은 커스텀 속성은 전달된다고 보장할 수 없습니다 (api-contract.md 6절).
 * - 그래서 message에는 사용자에게 그대로 보여 줘도 안전한 한국어 문장만 넣습니다.
 *   Groq 원문 응답, API 키, 내부 오류 내용은 절대 message에 넣지 않습니다.
 * - code와 details는 resolver에서 로그(console.error)를 남길 때만 씁니다.
 *   details에는 HTTP 상태 코드처럼 민감하지 않은 정보만 넣습니다.
 */

/**
 * 에러 코드 목록입니다. 오타를 막기 위해 문자열 대신 이 상수를 씁니다.
 * Object.freeze로 실수로 값을 바꾸지 못하게 합니다.
 */
export const ERROR_CODES = Object.freeze({
  INVALID_INPUT: 'INVALID_INPUT',
  JIRA_FETCH_FAILED: 'JIRA_FETCH_FAILED',
  CONFIGURATION_ERROR: 'CONFIGURATION_ERROR',
  LLM_REQUEST_FAILED: 'LLM_REQUEST_FAILED',
  LLM_TIMEOUT: 'LLM_TIMEOUT',
  EMPTY_MODEL_OUTPUT: 'EMPTY_MODEL_OUTPUT',
  INVALID_MODEL_OUTPUT: 'INVALID_MODEL_OUTPUT'
});

/**
 * 코드별 기본 안내 문구입니다. 화면에 그대로 표시됩니다.
 * INVALID_INPUT은 상황마다 안내가 달라서, throw하는 곳에서 문구를 직접 넘기는 경우가 많습니다.
 */
const DEFAULT_MESSAGES = Object.freeze({
  [ERROR_CODES.INVALID_INPUT]: '평가 요청 정보가 올바르지 않습니다. 이슈를 다시 분석한 뒤 시도해 주세요.',
  [ERROR_CODES.JIRA_FETCH_FAILED]: 'Jira 이슈 정보를 불러오지 못했습니다. 이슈 접근 권한을 확인한 뒤 다시 시도해 주세요.',
  [ERROR_CODES.CONFIGURATION_ERROR]: 'AI 평가 설정이 완료되지 않았습니다. 앱 관리자에게 문의해 주세요.',
  [ERROR_CODES.LLM_REQUEST_FAILED]: 'AI 평가 요청에 실패했습니다. 잠시 후 다시 시도해 주세요.',
  [ERROR_CODES.LLM_TIMEOUT]: 'AI 평가 응답 시간이 초과되었습니다. 다시 시도해 주세요.',
  [ERROR_CODES.EMPTY_MODEL_OUTPUT]: 'AI 평가 결과가 비어 있습니다. 다시 시도해 주세요.',
  [ERROR_CODES.INVALID_MODEL_OUTPUT]: 'AI 평가 결과 형식이 올바르지 않습니다. 다시 시도해 주세요.'
});

/** EvaluationError가 아닌 예상하지 못한 오류(버그 등)에 보여 줄 문구입니다. */
export const UNEXPECTED_ERROR_MESSAGE = 'AI 평가 중 알 수 없는 오류가 발생했습니다. 다시 시도해 주세요.';

/**
 * 답변 평가 과정에서 "예상된" 실패를 나타내는 에러입니다.
 *
 * @example
 *   throw new EvaluationError(ERROR_CODES.INVALID_INPUT, '답변을 입력해 주세요.');
 *   throw new EvaluationError(ERROR_CODES.LLM_REQUEST_FAILED, undefined, { status: 500 });
 */
export class EvaluationError extends Error {
  /**
   * @param {string} code ERROR_CODES 중 하나
   * @param {string} [message] 사용자에게 보여 줄 안전한 문구. 생략하면 코드별 기본 문구를 씁니다.
   * @param {Record<string, unknown>} [details] 로그용 부가 정보 (민감 정보 금지)
   */
  constructor(code, message, details = {}) {
    super(message || DEFAULT_MESSAGES[code] || UNEXPECTED_ERROR_MESSAGE);
    this.name = 'EvaluationError';
    this.code = code;
    this.details = details;
  }
}

/**
 * 어떤 오류든 사용자에게 보여 줘도 안전한 문구로 바꿉니다.
 * EvaluationError가 아니면(예: 코드 버그로 생긴 TypeError) 내부 내용을 숨기고 일반 문구를 돌려줍니다.
 *
 * @param {unknown} error
 * @returns {string}
 */
export function toSafeErrorMessage(error) {
  if (error instanceof EvaluationError) {
    return error.message;
  }

  return UNEXPECTED_ERROR_MESSAGE;
}
