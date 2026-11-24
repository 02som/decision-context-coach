/**
 * 총점·등급 계산 테스트 (docs/evaluation-rubric.md 4절)
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  LEVELS,
  MAX_TOTAL,
  computeTotal,
  getLevel,
  isValidScore
} from '../../src/evaluation/scoring.js';

describe('isValidScore', () => {
  it('0~4 정수만 허용한다', () => {
    for (const score of [0, 1, 2, 3, 4]) {
      assert.equal(isValidScore(score), true);
    }

    for (const score of [-1, 5, 2.5, '3', null, undefined, Number.NaN]) {
      assert.equal(isValidScore(score), false, `${String(score)} should be invalid`);
    }
  });
});

describe('computeTotal', () => {
  it('세 항목 점수를 더한다', () => {
    assert.equal(computeTotal({ accuracy: 3, evidence: 2, explanation: 1 }), 6);
    assert.equal(computeTotal({ accuracy: 4, evidence: 4, explanation: 4 }), MAX_TOTAL);
    assert.equal(computeTotal({ accuracy: 0, evidence: 0, explanation: 0 }), 0);
  });

  it('범위를 벗어난 점수가 들어오면 계산하지 않고 오류를 낸다', () => {
    assert.throws(() => computeTotal({ accuracy: 5, evidence: 2, explanation: 1 }), RangeError);
    assert.throws(() => computeTotal({ accuracy: 3, evidence: 2 }), RangeError);
  });
});

describe('getLevel', () => {
  it('등급 경계값을 루브릭대로 나눈다 (10~12 / 6~9 / 0~5)', () => {
    const expectations = [
      [12, LEVELS.STRONG],
      [10, LEVELS.STRONG],
      [9, LEVELS.NEEDS_IMPROVEMENT],
      [6, LEVELS.NEEDS_IMPROVEMENT],
      [5, LEVELS.INSUFFICIENT],
      [0, LEVELS.INSUFFICIENT]
    ];

    for (const [total, level] of expectations) {
      assert.equal(getLevel(total), level, `total ${total}`);
    }
  });

  it('0~12 정수가 아니면 오류를 낸다', () => {
    for (const total of [-1, 13, 6.5, '6']) {
      assert.throws(() => getLevel(total), RangeError);
    }
  });
});
