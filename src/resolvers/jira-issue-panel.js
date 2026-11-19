
import Resolver from '@forge/resolver';
import api, { route } from '@forge/api';

const resolver = new Resolver();

resolver.define('analyzeIssue', async ({ payload, context }) => {
  const issueKey = context.extension?.issue?.key;

  if (!issueKey) {
    throw new Error('Jira 이슈 정보를 찾을 수 없습니다.');
  }

  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    throw new Error('OPENAI_API_KEY가 설정되지 않았습니다.');
  }

  // 서버에서 Jira 데이터를 직접 가져옵니다.
  const jiraResponse = await api.asUser().requestJira(
    route`/rest/api/3/issue/${issueKey}?fields=summary,description`
  );

  if (!jiraResponse.ok) {
    throw new Error(`Jira 조회 실패: ${jiraResponse.status}`);
  }

  const issue = await jiraResponse.json();

  const issueData = {
    key: issue.key,
    summary: issue.fields.summary,
    description: issue.fields.description
  };

  const response = await api.fetch(
    'https://api.openai.com/v1/responses',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-4.1-mini',
        instructions: `
너는 소프트웨어 개발 의사결정을 돕는 AI 코치다.
제공된 Jira 이슈 정보만을 근거로 분석하라.
확인되지 않은 내용은 추측하지 말고
'확인 불가'로 표시하라.
한국어로 답변하라.

다음 형식으로 답변하라.

1. 문제 및 배경
2. 핵심 의사결정
3. 고려해야 할 기술적 사항
4. 추가로 확인할 정보
5. 개발자에게 던질 질문
        `,
        input: JSON.stringify(issueData),
        max_output_tokens: 800
      })
    }
  );

  const result = await response.json();

  if (!response.ok) {
    throw new Error(
      result.error?.message || `OpenAI API 오류: ${response.status}`
    );
  }

  const analysis = (result.output || [])
    .flatMap(item => item.content || [])
    .filter(item => item.type === 'output_text')
    .map(item => item.text)
    .join('\n');

  if (!analysis) {
    throw new Error('AI 분석 결과가 비어 있습니다.');
  }

  return analysis;
});

export const handler = resolver.getDefinitions();
