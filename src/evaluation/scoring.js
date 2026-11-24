/**
 * 점수 범위, 총점, 등급 계산 (WBS 2.4 / DFAS-136)
 *
 * 기준 문서: docs/evaluation-rubric.md 3~4절, docs/api-contract.md 5절
 * - 항목별 점수는 LLM이 매기고, 총점과 등급은 이 모듈이 계산합니다.
 * - 루브릭의 등급 구간을 바꾸면 이 파일과 두 문서를 함께 바꿔야 합니다.
 */

/** 채점 항목 이름입니다. LLM 출력의 scores 객체 키와 같습니다. */
export const SCORE_KEYS = Object.freeze(['accuracy', 'evidence', 'explanation']);

/** 항목별 최저·최고 점수입니다. */
export const MIN_SCORE = 0;
export const MAX_SCORE = 4;

/** 총점의 최고 점수입니다 (4점 × 3항목 = 12점). */
export const MAX_TOTAL = MAX_SCORE * SCORE_KEYS.length;

/** 화면과 Jira 댓글에 표시하는 등급 이름입니다. 기존 Mock 평가 UI의 이름을 그대로 씁니다. */
export const LEVELS = Object.freeze({
  STRONG: 'Strong',
  NEEDS_IMPROVEMENT: 'Needs improvement',
  INSUFFICIENT: 'Insufficient'
});

/**
 * 값이 올바른 항목 점수(0~4 정수)인지 확인합니다.
 * Number.isInteger는 2.5 같은 소수, "3" 같은 문자열, NaN을 모두 false로 처리합니다.
 *
 * @param {unknown} value
 * @returns {boolean}
 */
export function isValidScore(value) {
  return Number.isInteger(value) && value >= MIN_SCORE && value <= MAX_SCORE;
}

/**
 * 세 항목 점수의 합(총점)을 계산합니다.
 * 검증을 통과한 scores만 넘어온다고 가정하지만, 혹시 모를 버그를 빨리 찾도록 한 번 더 확인합니다.
 *
 * @param {{ accuracy: number, evidence: number, explanation: number }} scores
 * @returns {number} 0~12 정수
 */
export function computeTotal(scores) {
  return SCORE_KEYS.reduce((sum, key) => {
    if (!isValidScore(scores?.[key])) {
      throw new RangeError(`Invalid score for ${key}`);
    }

    return sum + scores[key];
  }, 0);
}

/**
 * 총점을 등급으로 바꿉니다.
 * - 10~12: Strong
 * - 6~9: Needs improvement
 * - 0~5: Insufficient
 *
 * @param {number} total 0~12 정수
 * @returns {string} LEVELS 값 중 하나
 */
export function getLevel(total) {
  if (!Number.isInteger(total) || total < 0 || total > MAX_TOTAL) {
    throw new RangeError('Invalid total score');
  }

  if (total >= 10) {
    return LEVELS.STRONG;
  }

  if (total >= 6) {
    return LEVELS.NEEDS_IMPROVEMENT;
  }

  return LEVELS.INSUFFICIENT;
}
