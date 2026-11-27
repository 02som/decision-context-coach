/**
 * Jira 텍스트 정제 모듈 테스트 (WBS 3.2 / DFAS-152)
 *
 * Jira·Forge 없이 ADF 예시를 넣어 규칙(R1~R6)대로 바뀌는지 확인합니다.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  adfToPlainText,
  toJiraContext,
  DESCRIPTION_MAX_CHARS,
  TRUNCATION_NOTICE_PREFIX
} from '../../src/resolvers/jira-description.js';

/** 짧게 ADF를 만드는 도우미 */
const doc = (...content) => ({ type: 'doc', version: 1, content });
const p = (...content) => ({ type: 'paragraph', content });
const t = (text, marks) => (marks ? { type: 'text', text, marks } : { type: 'text', text });
const li = (...content) => ({ type: 'listItem', content });

describe('adfToPlainText', () => {
  it('DFAS-152 문서의 OAuth 예시: 문장을 쪼개지 않고 목록 표시를 살린다 (R1·R2·R3)', () => {
    const adf = doc(
      p(t('인증은 '), t('OAuth', [{ type: 'strong' }]), t('로 결정했다')),
      { type: 'bulletList', content: [li(p(t('대안: 세션 로그인')))] }
    );

    assert.equal(adfToPlainText(adf), '인증은 OAuth로 결정했다\n\n- 대안: 세션 로그인');
  });

  it('문단 사이는 빈 줄 하나로 구분한다 (R2)', () => {
    const adf = doc(p(t('목표: 로그인 MVP')), p(t('완료 기준: 시연 가능')));
    assert.equal(adfToPlainText(adf), '목표: 로그인 MVP\n\n완료 기준: 시연 가능');
  });

  it('문단 안의 Shift+Enter 줄바꿈은 그대로 둔다', () => {
    const adf = doc(p(t('첫 줄'), { type: 'hardBreak' }, t('둘째 줄')));
    assert.equal(adfToPlainText(adf), '첫 줄\n둘째 줄');
  });

  it('번호 목록과 하위 목록 들여쓰기 (R3)', () => {
    const adf = doc({
      type: 'orderedList',
      attrs: { order: 1 },
      content: [
        li(p(t('토큰 발급')), { type: 'bulletList', content: [li(p(t('만료 1시간')))] }),
        li(p(t('권한 확인')))
      ]
    });

    assert.equal(adfToPlainText(adf), '1. 토큰 발급\n  - 만료 1시간\n2. 권한 확인');
  });

  it('제목은 글자만, 코드 블록은 ``` 로 감싸고 내용을 그대로 둔다 (R4)', () => {
    const adf = doc(
      { type: 'heading', attrs: { level: 2 }, content: [t('결정')] },
      { type: 'codeBlock', attrs: { language: 'js' }, content: [t('const a = 1;\n\n\nconst b = 2;')] }
    );

    assert.equal(adfToPlainText(adf), '결정\n\n```\nconst a = 1;\n\n\nconst b = 2;\n```');
  });

  it('표는 한 행 한 줄, 칸 사이 " | " (R4)', () => {
    const cell = (text) => ({ type: 'tableCell', content: [p(t(text))] });
    const adf = doc({
      type: 'table',
      content: [
        { type: 'tableRow', content: [cell('안'), cell('장점')] },
        { type: 'tableRow', content: [cell('OAuth'), cell('표준')] }
      ]
    });

    assert.equal(adfToPlainText(adf), '안 | 장점\nOAuth | 표준');
  });

  it('표 칸 앞뒤 공백은 지운다 (R5, DFAS-156 실제 이슈에서 발견)', () => {
    const cell = (text) => ({ type: 'tableCell', content: [p(t(text))] });
    const table = { type: 'table', content: [{ type: 'tableRow', content: [cell('비밀번호 보관 '), cell(' 필요 없음 ')] }] };
    assert.equal(adfToPlainText(doc(table)), '비밀번호 보관 | 필요 없음');
  });

  it('링크는 글자, 링크 카드는 주소, 첨부는 [attachment] (R4)', () => {
    const adf = doc(
      p(t('문서', [{ type: 'link', attrs: { href: 'https://example.com' } }]), t(' 참고')),
      p({ type: 'inlineCard', attrs: { url: 'https://example.com/a' } }),
      { type: 'mediaSingle', content: [{ type: 'media', attrs: { id: 'x' } }] }
    );

    assert.equal(adfToPlainText(adf), '문서 참고\n\nhttps://example.com/a\n\n[attachment]');
  });

  it('멘션 이름은 내보내지 않는다', () => {
    const adf = doc(p({ type: 'mention', attrs: { id: 'abc', text: '@홍길동' } }, t(' 님 확인')));
    assert.equal(adfToPlainText(adf), '님 확인');
  });

  it('공백 정리: 앞뒤 공백 제거, 빈 문단은 사라진다 (R5)', () => {
    const adf = doc(p(t('  ')), p(t('내용  ')), p(), p(t('끝')));
    assert.equal(adfToPlainText(adf), '내용\n\n끝');
  });

  it('설명이 없거나 공백뿐이면 빈 문자열 (api-contract.md 2절)', () => {
    assert.equal(adfToPlainText(null), '');
    assert.equal(adfToPlainText(undefined), '');
    assert.equal(adfToPlainText(doc()), '');
    assert.equal(adfToPlainText(doc(p(t('   ')))), '');
  });

  it('이미 문자열인 설명은 공백만 정리한다', () => {
    assert.equal(adfToPlainText('  설명\n\n\n\n다음  '), '설명\n\n다음');
  });
});

describe('adfToPlainText 긴 설명 처리 (R6)', () => {
  const NOTICE = /\n\n\(Truncated: the description was too long, so only the first \d+ of \d+ characters are included\.\)$/;

  it('최대 길이 이하면 자르지 않고 안내도 붙이지 않는다', () => {
    const text = '가'.repeat(50);
    assert.equal(adfToPlainText(text, { maxChars: 50 }), text);
  });

  it('최대 길이를 넘으면 앞부분만 남기고 원문 길이를 안내한다', () => {
    const text = '가'.repeat(80);
    const result = adfToPlainText(text, { maxChars: 50 });

    assert.ok(result.startsWith('가'.repeat(50)));
    assert.match(result, NOTICE);
    assert.ok(result.includes('first 50 of 80 characters'));
  });

  it('문장 중간이 아니라 문장 끝에서 자른다 (기준 1)', () => {
    const first = 'OAuth로 결정했다. '.repeat(4).trimEnd();
    const text = `${first} 세션 로그인은 대안으로만 남긴다.`;
    const result = adfToPlainText(text, { maxChars: 60 });

    assert.ok(result.startsWith(`${first}\n\n(Truncated`));
  });

  it('최대 길이 80% 뒤에 문장 끝이 없으면 최대 길이에서 그대로 자른다', () => {
    const text = `짧다. ${'가'.repeat(100)}`;
    const result = adfToPlainText(text, { maxChars: 50 });

    assert.ok(result.includes('first 50 of'));
  });

  it('코드 블록 안에서 잘리면 코드 블록을 닫아 준다', () => {
    const code = { type: 'codeBlock', content: [t('x\n'.repeat(40))] };
    const result = adfToPlainText(doc(p(t('설명')), code), { maxChars: 30 });
    const fences = result.split('\n').filter((line) => line.trim() === '```').length;

    assert.equal(fences % 2, 0);
    assert.match(result, NOTICE);
  });

  it('잘림 안내는 TRUNCATION_NOTICE_PREFIX로 시작한다 (평가 모듈이 이 값으로 잘림을 판단)', () => {
    const result = adfToPlainText('가'.repeat(80), { maxChars: 50 });
    const notice = result.slice(result.lastIndexOf('\n\n') + 2);

    assert.ok(notice.startsWith(TRUNCATION_NOTICE_PREFIX));
    assert.ok(!adfToPlainText('가'.repeat(50), { maxChars: 50 }).includes(TRUNCATION_NOTICE_PREFIX));
  });

  it('기본 최대 길이는 DESCRIPTION_MAX_CHARS이고 ADF 설명에도 적용된다', () => {
    const long = doc(p(t('나'.repeat(DESCRIPTION_MAX_CHARS + 10))));
    const result = adfToPlainText(long);

    assert.match(result, NOTICE);
    assert.ok(result.includes(`first ${DESCRIPTION_MAX_CHARS} of`));
  });
});

describe('toJiraContext', () => {
  it('Jira 응답을 2절 형식으로 만든다', () => {
    const issue = { key: 'DFAS-999', fields: { summary: '  로그인 방식 결정 ', description: doc(p(t('내용'))) } };

    assert.deepEqual(toJiraContext(issue), {
      key: 'DFAS-999',
      summary: '로그인 방식 결정',
      description: '내용'
    });
  });

  it('설명이 없으면 description은 빈 문자열', () => {
    const issue = { key: 'DFAS-999', fields: { summary: '제목', description: null } };
    assert.equal(toJiraContext(issue).description, '');
  });

  it('분석 경로도 평가 경로와 같은 기준으로 자른다 (R6)', () => {
    const description = doc(p(t('다'.repeat(DESCRIPTION_MAX_CHARS + 10))));
    const issue = { key: 'DFAS-999', fields: { summary: '제목', description } };

    assert.equal(toJiraContext(issue).description, adfToPlainText(description));
  });

  it('key나 summary가 없으면 오류 (api-contract.md 2절)', () => {
    assert.throws(() => toJiraContext({ key: 'DFAS-1', fields: { summary: '  ' } }));
    assert.throws(() => toJiraContext({ fields: { summary: '제목' } }));
    assert.throws(() => toJiraContext(null));
  });
});
