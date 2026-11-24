/**
 * 실제 Groq API로 답변 평가를 실행해 보는 로컬 스크립트 (WBS 2.7 / DFAS-139)
 *
 * 단위 테스트(npm test)는 가짜 응답으로 코드 흐름만 검사합니다.
 * 이 스크립트는 실제 모델이 루브릭대로 채점하는지 확인하고, 팀에 전달할 샘플 결과를 만듭니다.
 * Forge를 거치지 않고 Node의 기본 fetch로 Groq를 직접 호출합니다.
 *
 * 준비:
 *   1. 프로젝트 루트에 .env 파일을 만들고 한 줄을 넣습니다. (.env는 .gitignore에 있어 커밋되지 않습니다)
 *        GROQ_API_KEY=발급받은_키
 *   2. conda activate decision-context-coach
 *
 * 실행:
 *   npm run try:evaluation              # 모든 예시 실행
 *   npm run try:evaluation -- strong    # 특정 예시만 실행 (sample, strong, injection, wrong, blank)
 *
 * 주의: 실행할 때마다 Groq 사용량이 듭니다. API 키는 출력하지 않습니다.
 */

import { runEvaluateAnswer } from '../src/evaluation/evaluate-answer.js';
import { ANSWERS, ISSUE, buildPayload } from '../test/evaluation/helpers.js';

/**
 * 실행할 예시 목록입니다.
 * expected는 docs/evaluation-rubric.md 8절의 기대 점수입니다 (LLM 판단이라 ±1점 차이는 있을 수 있음).
 */
const CASES = [
  { name: 'sample', label: '예시 A: 계약서 샘플 답변', answer: ANSWERS.sample, expected: '3/2/1 (6점, Needs improvement)' },
  { name: 'strong', label: '예시 B: 강한 답변', answer: ANSWERS.strong, expected: '4/4/4 (12점, Strong)' },
  { name: 'injection', label: '예시 C: 근거 없는 단정 + 인젝션', answer: ANSWERS.injection, expected: '0/1/0 (1점, Insufficient), Keycloak 주장이 unverifiedClaims에 들어감' },
  { name: 'wrong', label: '오답: 서버 검증이 필요 없다는 답변', answer: ANSWERS.wrong, expected: '낮은 점수 (Insufficient)' },
  { name: 'blank', label: '빈 답변', answer: '   ', expected: 'INVALID_INPUT, Groq 호출 없음' }
];

/** 예시 하나를 실행하고, 성공·실패 결과를 출력용 객체로 돌려줍니다. */
async function runCase(testCase, apiKey) {
  const startedAt = Date.now();

  try {
    const result = await runEvaluateAnswer({
      payload: buildPayload({ answer: testCase.answer }),
      activeIssueKey: ISSUE.key,
      // 실제 Forge에서는 resolver가 Jira를 다시 조회합니다. 여기서는 FLOW-1 예시 이슈를 그대로 돌려줍니다.
      loadIssue: async () => ({ ...ISSUE }),
      apiKey,
      fetchFn: (url, options) => fetch(url, options)
    });

    return { ok: true, ms: Date.now() - startedAt, result };
  } catch (error) {
    return {
      ok: false,
      ms: Date.now() - startedAt,
      error: { code: error.code ?? 'UNEXPECTED', message: error.message, details: error.details }
    };
  }
}

async function main() {
  const apiKey = process.env.GROQ_API_KEY;

  if (!apiKey) {
    console.error('GROQ_API_KEY가 없습니다. 프로젝트 루트의 .env 파일에 GROQ_API_KEY=... 를 넣고 다시 실행하세요.');
    process.exitCode = 1;
    return;
  }

  // 명령줄에서 예시 이름을 주면 그 예시만 실행합니다.
  const selected = process.argv.slice(2);
  const cases = selected.length > 0 ? CASES.filter((item) => selected.includes(item.name)) : CASES;

  if (cases.length === 0) {
    console.error(`알 수 없는 예시 이름입니다. 사용 가능: ${CASES.map((item) => item.name).join(', ')}`);
    process.exitCode = 1;
    return;
  }

  console.log(`이슈: ${ISSUE.key} ${ISSUE.summary}\n`);

  const summary = [];

  // 요청 한도(rate limit)에 걸리지 않도록 예시를 하나씩 순서대로 실행합니다.
  for (const testCase of cases) {
    const outcome = await runCase(testCase, apiKey);

    console.log(`=== ${testCase.label} (${testCase.name}) ===`);
    console.log(`기대: ${testCase.expected}`);
    console.log(JSON.stringify(outcome, null, 2));
    console.log('');

    summary.push({
      case: testCase.name,
      expected: testCase.expected,
      actual: outcome.ok
        ? `${outcome.result.scores.accuracy}/${outcome.result.scores.evidence}/${outcome.result.scores.explanation} (${outcome.result.total}점, ${outcome.result.level})`
        : outcome.error.code,
      ms: outcome.ms
    });
  }

  console.log('=== 요약 ===');
  console.table(summary);
}

await main();
