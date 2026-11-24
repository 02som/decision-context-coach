/**
 * 요청 검증, Jira 이슈 정규화, LLM 출력 검증 테스트
 * (docs/api-contract.md 4~6절, docs/evaluation-rubric.md 5·7절)
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { ERROR_CODES, EvaluationError } from '../../src/evaluation/errors.js';
import {
  MAX_ANSWER_LENGTH,
  normalizeIssueContext,
  parseEvaluationOutput,
  validateEvaluationRequest
} from '../../src/evaluation/validation.js';
import { ANALYSIS, ANSWERS, ISSUE, QUESTION, buildModelOutput, buildPayload } from './helpers.js';

/** 주어진 함수가 특정 코드의 EvaluationError를 던지는지 확인합니다. */
function assertEvaluationError(fn, code) {
  assert.throws(fn, (error) => {
    assert.ok(error instanceof EvaluationError, 'should be EvaluationError');
    assert.equal(error.code, code);
    return true;
  });
}

describe('validateEvaluationRequest', () => {
  it('정상 요청은 공백을 정리한 값을 돌려준다', () => {
    const request = validateEvaluationRequest(
      buildPayload({ answer: `  ${ANSWERS.sample}\n`, question: ` ${QUESTION} ` })
    );

    assert.equal(request.issueKey, ISSUE.key);
    assert.equal(request.answer, ANSWERS.sample);
    assert.equal(request.question, QUESTION);
    assert.deepEqual(request.analysis, { ...ANALYSIS });
  });

  it('빈 답변과 공백뿐인 답변을 거부한다', () => {
    for (const answer of ['', '   ', '\n\t', undefined, null, 123]) {
      assert.throws(
        () => validateEvaluationRequest(buildPayload({ answer })),
        (error) => {
          assert.equal(error.code, ERROR_CODES.INVALID_INPUT);
          assert.equal(error.message, '답변을 입력해 주세요.');
          return true;
        }
      );
    }
  });

  it('너무 긴 답변을 거부한다', () => {
    const answer = 'a'.repeat(MAX_ANSWER_LENGTH + 1);
    assertEvaluationError(() => validateEvaluationRequest(buildPayload({ answer })), ERROR_CODES.INVALID_INPUT);
  });

  it('최대 길이와 같은 답변은 허용한다', () => {
    const answer = 'a'.repeat(MAX_ANSWER_LENGTH);
    assert.equal(validateEvaluationRequest(buildPayload({ answer })).answer.length, MAX_ANSWER_LENGTH);
  });

  it('question이 analysis.question과 다르면 거부한다', () => {
    assertEvaluationError(
      () => validateEvaluationRequest(buildPayload({ question: '다른 질문입니까?' })),
      ERROR_CODES.INVALID_INPUT
    );
  });

  it('analysis 필드가 빠지면 거부한다', () => {
    for (const field of Object.keys(ANALYSIS)) {
      const analysis = { ...ANALYSIS };
      delete analysis[field];
      assertEvaluationError(
        () => validateEvaluationRequest(buildPayload({ analysis })),
        ERROR_CODES.INVALID_INPUT
      );
    }
  });

  it('형식이 틀린 이슈 키와 payload를 거부한다', () => {
    for (const issueKey of ['', 'FLOW', '../FLOW-1', 'FLOW-1/comment', 42]) {
      assertEvaluationError(
        () => validateEvaluationRequest(buildPayload({ issueKey })),
        ERROR_CODES.INVALID_INPUT
      );
    }

    for (const payload of [null, undefined, 'text', []]) {
      assertEvaluationError(() => validateEvaluationRequest(payload), ERROR_CODES.INVALID_INPUT);
    }
  });
});

describe('normalizeIssueContext', () => {
  it('description이 없으면 빈 문자열로 정규화한다', () => {
    assert.deepEqual(normalizeIssueContext({ key: 'FLOW-1', summary: ' 제목 ' }), {
      key: 'FLOW-1',
      summary: '제목',
      description: ''
    });
  });

  it('key나 summary가 없으면 JIRA_FETCH_FAILED로 실패한다', () => {
    for (const issue of [null, {}, { key: 'FLOW-1' }, { summary: '제목' }, { key: 'FLOW-1', summary: '  ' }]) {
      assertEvaluationError(() => normalizeIssueContext(issue), ERROR_CODES.JIRA_FETCH_FAILED);
    }
  });
});

describe('parseEvaluationOutput', () => {
  it('정상 출력을 파싱하고 문자열 공백을 정리한다', () => {
    const output = buildModelOutput({
      feedback: '  좋은 답변이다. ',
      unverifiedClaims: [' Keycloak 사용 여부는 확인할 수 없다. ']
    });

    assert.deepEqual(parseEvaluationOutput(JSON.stringify(output)), {
      scores: { accuracy: 3, evidence: 2, explanation: 1 },
      feedback: '좋은 답변이다.',
      improvement: output.improvement,
      unverifiedClaims: ['Keycloak 사용 여부는 확인할 수 없다.']
    });
  });

  it('LLM이 임의로 넣은 필드(total, level 등)는 버린다', () => {
    const output = {
      ...buildModelOutput(),
      total: 12,
      level: 'Strong',
      scores: { accuracy: 3, evidence: 2, explanation: 1, bonus: 4 }
    };

    const parsed = parseEvaluationOutput(JSON.stringify(output));
    assert.deepEqual(Object.keys(parsed), ['scores', 'feedback', 'improvement', 'unverifiedClaims']);
    assert.deepEqual(parsed.scores, { accuracy: 3, evidence: 2, explanation: 1 });
  });

  it('빈 문자열 claim은 버린다', () => {
    const parsed = parseEvaluationOutput(JSON.stringify(buildModelOutput({ unverifiedClaims: ['', '  '] })));
    assert.deepEqual(parsed.unverifiedClaims, []);
  });

  it('깨진 JSON과 JSON 객체가 아닌 출력을 거부한다', () => {
    for (const content of ['{"scores": {', 'not json', '```json\n{}\n```', '[]', 'null', '"text"']) {
      assertEvaluationError(() => parseEvaluationOutput(content), ERROR_CODES.INVALID_MODEL_OUTPUT);
    }
  });

  it('범위 밖이거나 정수가 아닌 점수를 거부한다 (보정하지 않음)', () => {
    for (const badScore of [5, -1, 2.5, '3', null, true]) {
      const output = buildModelOutput({ scores: { accuracy: badScore, evidence: 2, explanation: 1 } });
      assertEvaluationError(
        () => parseEvaluationOutput(JSON.stringify(output)),
        ERROR_CODES.INVALID_MODEL_OUTPUT
      );
    }
  });

  it('점수 항목이 빠지면 거부한다', () => {
    const output = buildModelOutput({ scores: { accuracy: 3, explanation: 1 } });
    assertEvaluationError(() => parseEvaluationOutput(JSON.stringify(output)), ERROR_CODES.INVALID_MODEL_OUTPUT);
  });

  it('feedback·improvement가 비어 있으면 거부한다', () => {
    for (const overrides of [{ feedback: '' }, { feedback: '  ' }, { improvement: '' }, { improvement: 3 }]) {
      assertEvaluationError(
        () => parseEvaluationOutput(JSON.stringify(buildModelOutput(overrides))),
        ERROR_CODES.INVALID_MODEL_OUTPUT
      );
    }
  });

  it('unverifiedClaims가 문자열 배열이 아니면 거부한다', () => {
    for (const unverifiedClaims of ['없음', null, [1, 2], [{ claim: 'x' }]]) {
      assertEvaluationError(
        () => parseEvaluationOutput(JSON.stringify(buildModelOutput({ unverifiedClaims }))),
        ERROR_CODES.INVALID_MODEL_OUTPUT
      );
    }
  });
});
