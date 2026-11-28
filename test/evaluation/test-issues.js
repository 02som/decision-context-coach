/**
 * 실제 Jira 테스트 이슈(DFAS-156·157)로 만든 평가 테스트 데이터 (DFAS-154 문제 ③·④)
 *
 * 이슈 내용은 박경서 님이 만든 정규화 예시 데이터(test/fixtures/jira/*.normalized.json)를 그대로 읽습니다.
 * 이 데이터는 실제 앱과 같은 전처리(jira-description.js)를 거친 결과라서,
 * DFAS-157은 설명이 3,000자 기준으로 잘리고 끝에 "(Truncated: ...)" 안내가 붙어 있습니다.
 *
 * analysis와 question은 analyzeIssue가 만들었다고 가정한 값입니다. 앱이 영어로 바뀌어서(main 923fb58) 영어로 씁니다.
 * 이 파일은 이름이 *.test.js가 아니어서 테스트로 실행되지 않습니다.
 */

import { readFileSync } from 'node:fs';

/** test/fixtures/jira/ 의 정규화 예시 데이터를 읽습니다. */
function loadNormalizedIssue(key) {
  const url = new URL(`../fixtures/jira/${key}.normalized.json`, import.meta.url);
  return Object.freeze(JSON.parse(readFileSync(url, 'utf8')));
}

/** DFAS-156: 결정(OAuth 2.0)과 대안이 명확한 이슈. 문제 ③("idk" 3/12)을 재현한 이슈입니다. */
export const LOGIN_ISSUE = loadNormalizedIssue('DFAS-156');

export const LOGIN_QUESTION = 'How would you handle token expiry and renewal in the OAuth 2.0 login flow?';

export const LOGIN_ANALYSIS = Object.freeze({
  decision: 'Use OAuth 2.0 with Google accounts for login instead of session-based login.',
  risk: 'If token expiry and renewal are not handled, users may be logged out unexpectedly.',
  technicalConsiderations:
    'Register the Google OAuth app, configure the callback URL, and handle token renewal when the token expires (TOKEN_EXPIRES_IN=3600).',
  missingInformation: 'How tokens are stored on the client and server is not specified.',
  question: LOGIN_QUESTION
});

/** DFAS-157: 결정이 긴 설명 끝(4,251자부터)에 있어 R6에서 잘리는 이슈. 문제 ④를 재현한 이슈입니다. */
export const CACHE_ISSUE = loadNormalizedIssue('DFAS-157');

export const CACHE_QUESTION = 'Which caching approach would you choose for the analysis results, and why?';

export const CACHE_ANALYSIS = Object.freeze({
  decision:
    'Decision pending: choose between no cache, an in-memory frontend cache, and a Forge storage cache for analysis results.',
  risk: 'Cached results can become stale when the issue changes, and adding storage permissions requires redeployment.',
  technicalConsiderations:
    'Key the cache by issue key and description hash, set an expiry, and provide a re-analyze option.',
  missingInformation: 'Which candidate the team selected is unknown because the description was truncated.',
  question: CACHE_QUESTION
});

/** 테스트 이슈용 답변입니다. */
export const TEST_ISSUE_ANSWERS = Object.freeze({
  // 문제 ③: 답하려는 시도가 없는 답변 (v5까지 3/12, 기대 0/0/0)
  idk: 'idk',
  // ③의 대조군: 불확실하다고 밝히지만 방법과 이유를 제시한 답변 (0점이 되면 안 됨)
  unsure:
    "I'm not completely sure, but I think the backend should check the token expiry (TOKEN_EXPIRES_IN=3600) before each call and use the refresh token to get a new access token before it expires, so users are not logged out in the middle of their work. I would need to confirm whether our Google OAuth setup returns a refresh token.",
  // 문제 ④: 잘린 뒷부분(최종 결정)에 있는 사실을 말한 답변. 잘렸다는 이유로 감점되면 안 됨
  truncated:
    "The team already decided to use candidate 2, the in-memory frontend cache, together with a re-analyze button for the MVP, and postponed candidate 3 because adding storage permissions means redeploying right before the deadline. I would keep the result in a variable keyed by the issue key while the panel is open, so reopening the same issue shows the result instantly, and the re-analyze button clears it and requests a new analysis.",
  // 문제 ④ 보고서의 원래 답변 (v5에서 1/12, 확인 불가로 표시됨)
  truncatedShort: 'I would use memory cache first.'
});

/** 테스트 이슈용 평가 요청 payload를 만듭니다. */
export function buildTestIssuePayload(issue, analysis, answer) {
  return {
    issueKey: issue.key,
    analysis: { ...analysis },
    question: analysis.question,
    answer
  };
}
