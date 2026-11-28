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
 *   npm run try:evaluation                      # 모든 예시 1회
 *   npm run try:evaluation -- --runs=3          # 모든 예시 3회 반복 (결과가 안정적인지 확인)
 *   npm run try:evaluation -- strong injection  # 특정 예시만 (아래 CASES의 name)
 *
 * 요청 한도(rate limit):
 *   Groq 무료 키는 분당 사용량 한도가 있어 연속 호출하면 429가 납니다.
 *   그래서 호출 사이에 EVAL_DELAY_MS(기본 20초)만큼 쉬고, 429가 나면 60초 기다린 뒤 한 번 더 시도합니다.
 *   예: EVAL_DELAY_MS=5000 npm run try:evaluation
 *
 * 주의: 실행할 때마다 Groq 사용량이 듭니다. API 키는 출력하지 않습니다.
 */

import { runEvaluateAnswer } from '../src/evaluation/evaluate-answer.js';
import { EVALUATION_PROMPT_VERSION } from '../src/evaluation/prompt.js';
import { ANALYSIS, ANSWERS, ISSUE } from '../test/evaluation/helpers.js';
import {
  CACHE_ANALYSIS,
  CACHE_ISSUE,
  LOGIN_ANALYSIS,
  LOGIN_ISSUE,
  TEST_ISSUE_ANSWERS
} from '../test/evaluation/test-issues.js';

/** 예시 하나가 평가할 이슈와 분석 결과입니다. */
const FLOW_1 = { issue: ISSUE, analysis: ANALYSIS };
const DFAS_156 = { issue: LOGIN_ISSUE, analysis: LOGIN_ANALYSIS };
const DFAS_157 = { issue: CACHE_ISSUE, analysis: CACHE_ANALYSIS };

/**
 * 실행할 예시 목록입니다.
 * expected는 docs/evaluation-rubric.md 8절의 기대 결과입니다 (LLM 판단이라 ±1점 차이는 있을 수 있음).
 * callsGroq가 false인 예시는 Groq를 호출하지 않으므로 대기 시간을 두지 않습니다.
 */
const CASES = [
  { name: 'sample', label: '예시 A: 계약서 샘플 답변', ...FLOW_1, answer: ANSWERS.sample, expected: '3/2/1 (6점, Needs improvement)', callsGroq: true },
  { name: 'strong', label: '예시 B: 강한 답변', ...FLOW_1, answer: ANSWERS.strong, expected: '4/4/4 (12점, Strong)', callsGroq: true },
  { name: 'injection', label: '예시 C: 근거 없는 단정 + 인젝션', ...FLOW_1, answer: ANSWERS.injection, expected: '0/1/0 (1점, Insufficient), 안내 문장 + Keycloak 확인 불가', callsGroq: true },
  { name: 'wrong', label: '오답: 서버 검증이 필요 없다는 답변', ...FLOW_1, answer: ANSWERS.wrong, expected: '낮은 점수 (Insufficient)', callsGroq: true },
  { name: 'blank', label: '빈 답변', ...FLOW_1, answer: '   ', expected: 'INVALID_INPUT, Groq 호출 없음', callsGroq: false },
  { name: 'idk', label: '예시 D: 답하려는 시도가 없는 답변 (DFAS-156)', ...DFAS_156, answer: TEST_ISSUE_ANSWERS.idk, expected: '0/0/0 (0점, Insufficient), 확인 불가 없음', callsGroq: true },
  { name: 'unsure', label: '예시 E: 불확실하다고 밝힌 답변 (DFAS-156)', ...DFAS_156, answer: TEST_ISSUE_ANSWERS.unsure, expected: '0점이 아님 (평소대로 채점)', callsGroq: true },
  { name: 'truncated', label: '예시 F: 잘린 뒷부분의 결정을 말한 답변 (DFAS-157)', ...DFAS_157, answer: TEST_ISSUE_ANSWERS.truncated, expected: 'evidence 감점 없음, 결정은 "...because the Jira description was truncated."로 표시', callsGroq: true },
  { name: 'truncatedShort', label: '예시 G: 보고서 원래 답변 (DFAS-157)', ...DFAS_157, answer: TEST_ISSUE_ANSWERS.truncatedShort, expected: '낮은 점수 (이유 없음), "cannot be verified from the Jira issue" 표시 없음', callsGroq: true }
];

/** 호출 사이 대기 시간(밀리초)입니다. */
const DELAY_MS = Number(process.env.EVAL_DELAY_MS ?? 20000);

/** 429를 받았을 때 다시 시도하기 전 대기 시간(밀리초)입니다. */
const RATE_LIMIT_WAIT_MS = 60000;

/** 지정한 시간만큼 기다립니다. */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** 예시 하나를 한 번 실행하고, 성공·실패 결과를 출력용 객체로 돌려줍니다. */
async function runOnce(testCase, apiKey) {
  const startedAt = Date.now();

  try {
    const { issue, analysis } = testCase;

    const result = await runEvaluateAnswer({
      payload: {
        issueKey: issue.key,
        analysis: { ...analysis },
        question: analysis.question,
        answer: testCase.answer
      },
      activeIssueKey: issue.key,
      // 실제 Forge에서는 resolver가 Jira를 다시 조회합니다. 여기서는 예시 이슈를 그대로 돌려줍니다.
      loadIssue: async () => ({ ...issue }),
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

/** 429(요청 한도 초과)면 기다렸다가 한 번 더 시도합니다. */
async function runWithRateLimitRetry(testCase, apiKey) {
  const outcome = await runOnce(testCase, apiKey);

  if (!outcome.ok && outcome.error.details?.status === 429) {
    console.log(`  (429 요청 한도 초과, ${RATE_LIMIT_WAIT_MS / 1000}초 기다린 뒤 다시 시도합니다)`);
    await sleep(RATE_LIMIT_WAIT_MS);
    return runOnce(testCase, apiKey);
  }

  return outcome;
}

/** 결과를 요약표 한 칸에 들어갈 짧은 문자열로 바꿉니다. */
function summarize(outcome) {
  if (!outcome.ok) {
    return outcome.error.code;
  }

  const { scores, total, level } = outcome.result;
  return `${scores.accuracy}/${scores.evidence}/${scores.explanation} (${total}, ${level})`;
}

/** 명령줄 인자에서 --runs=N과 예시 이름을 읽습니다. */
function parseArgs(argv) {
  const runsArg = argv.find((arg) => arg.startsWith('--runs='));
  const runs = runsArg ? Number(runsArg.split('=')[1]) : 1;
  const names = argv.filter((arg) => !arg.startsWith('--'));

  return { runs: Number.isInteger(runs) && runs > 0 ? runs : 1, names };
}

async function main() {
  const apiKey = process.env.GROQ_API_KEY;

  if (!apiKey) {
    console.error('GROQ_API_KEY가 없습니다. 프로젝트 루트의 .env 파일에 GROQ_API_KEY=... 를 넣고 다시 실행하세요.');
    process.exitCode = 1;
    return;
  }

  const { runs, names } = parseArgs(process.argv.slice(2));
  const cases = names.length > 0 ? CASES.filter((item) => names.includes(item.name)) : CASES;

  if (cases.length === 0) {
    console.error(`알 수 없는 예시 이름입니다. 사용 가능: ${CASES.map((item) => item.name).join(', ')}`);
    process.exitCode = 1;
    return;
  }

  const issueKeys = [...new Set(cases.map((item) => item.issue.key))].join(', ');
  console.log(`프롬프트: ${EVALUATION_PROMPT_VERSION} / 이슈: ${issueKeys}`);
  console.log(`반복: ${runs}회 / 호출 간격: ${DELAY_MS / 1000}초\n`);

  // summary[예시 이름] = 회차별 결과 문자열 배열
  const summary = Object.fromEntries(cases.map((item) => [item.name, []]));
  let groqCallsMade = 0;

  for (let run = 1; run <= runs; run += 1) {
    for (const testCase of cases) {
      // 요청 한도에 걸리지 않도록, Groq를 부르는 예시 사이에 쉬어 갑니다.
      if (testCase.callsGroq && groqCallsMade > 0) {
        await sleep(DELAY_MS);
      }

      const outcome = await runWithRateLimitRetry(testCase, apiKey);

      if (testCase.callsGroq) {
        groqCallsMade += 1;
      }

      console.log(`=== [${run}/${runs}] ${testCase.label} (${testCase.name}) ===`);
      console.log(`기대: ${testCase.expected}`);
      console.log(JSON.stringify(outcome, null, 2));
      console.log('');

      summary[testCase.name].push(summarize(outcome));
    }
  }

  console.log('=== 요약 (accuracy/evidence/explanation (총점, 등급)) ===');
  console.table(
    cases.map((item) => ({
      case: item.name,
      expected: item.expected,
      ...Object.fromEntries(summary[item.name].map((value, index) => [`run${index + 1}`, value]))
    }))
  );
}

await main();
