
import React, { useEffect, useRef, useState } from 'react';
import ForgeReconciler, {
  Text,
  Heading,
  Stack,
  Button,
  TextArea,
  Spinner,
  SectionMessage
} from '@forge/react';

import { requestJira, view, invoke } from '@forge/bridge';

const extractJiraText = (node) => {
  if (!node) return '';

  if (typeof node === 'string') {
    return node;
  }

  if (Array.isArray(node)) {
    return node.map(extractJiraText).join('\n');
  }

  if (typeof node !== 'object') {
    return '';
  }

  if (node.type === 'text') {
    return node.text || '';
  }

  const children = node.content || [];

  return children.map(extractJiraText).join(
    node.type === 'paragraph' ? '' : '\n'
  );
};

const createMockAnalysis = (issue) => {
  const title = issue.fields.summary || '';
  const description = issue.fields.description;
  const issueCode = title.match(/\[D(0[1-9])\]/i)?.[1];

  const rules = {
    '01': {
      decision: 'Choose the Forge app structure and Jira Issue Panel setup.',
      risk: 'Incorrect manifest settings or permissions may prevent the app from loading.',
      question: 'How would you verify that a Forge Issue Panel is correctly installed and running?'
    },
    '02': {
      decision: 'Choose how to retrieve Jira issue data through the REST API.',
      risk: 'API errors or missing permissions may prevent issue data retrieval.',
      question: 'How would you handle Jira REST API failures and missing issue fields?'
    },
    '03': {
      decision: 'Determine which Jira context is necessary for technical analysis.',
      risk: 'Incomplete or irrelevant context may lead to unsupported decisions.',
      question: 'Which Jira fields are essential for understanding an issue, and why?'
    },
    '04': {
      decision: 'Design a secure and reliable LLM API integration.',
      risk: 'API credentials may be exposed or external requests may fail.',
      question: 'How would you protect API keys and handle LLM API failures in Forge?'
    },
    '05': {
      decision: 'Define the structure and evidence requirements of a Decision Card.',
      risk: 'A Decision Card may contain unsupported claims or omit important risks.',
      question: 'What information should a Decision Card contain to support technical decisions?'
    },
    '06': {
      decision: 'Determine how to generate a technical question from Jira context.',
      risk: 'Generated questions may be too generic or unrelated to the issue.',
      question: 'How would you ensure a technical question is grounded in Jira issue information?'
    },
    '07': {
      decision: 'Design the user answer input and submission experience.',
      risk: 'Invalid input or state handling errors may interrupt the workflow.',
      question: 'How would you validate and manage user answers in the Jira Issue Panel?'
    },
    '08': {
      decision: 'Define criteria for evaluating answers against Jira evidence.',
      risk: 'Feedback may incorrectly present unsupported claims as verified facts.',
      question: 'How would you evaluate technical reasoning without inventing evidence?'
    },
    '09': {
      decision: 'Integrate issue analysis, questions, answers, and feedback.',
      risk: 'Failures between workflow stages may cause inconsistent application state.',
      question: 'How would you test and recover from failures across the complete workflow?'
    }
  };

  const selected = rules[issueCode] || {
    decision: 'Identify the main technical decision required by this issue.',
    risk: 'The available Jira context may be incomplete.',
    question: 'What is the most important technical decision for this issue, and why?'
  };

  const descriptionText = extractJiraText(description).trim();

  return {
    ...selected,
    evidence: title,
    hasDescription: descriptionText.length > 0,
    descriptionText
  };
};



// 답변 평가는 백엔드 resolver의 evaluateAnswer(Groq AI)가 합니다 (WBS 2.6 / DFAS-138).
// 예전 규칙 기반 평가(evaluateMockAnswer)는 삭제했습니다. AI 평가가 실패해도 규칙 기반 점수로 대신하지 않습니다.
// 채점 기준: docs/evaluation-rubric.md, 응답 형식: docs/api-contract.md 5절

const App = () => {
  const [issue, setIssue] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [analysis, setAnalysis] = useState(false);
  const [answer, setAnswer] = useState('');
  const [feedback, setFeedback] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState('');
  const [analyzing, setAnalyzing] = useState(false);
  const [evaluating, setEvaluating] = useState(false);

  // AI 평가는 몇 초 걸립니다. 그사이 사용자가 이슈를 다시 분석하거나 답변을 고치면
  // 늦게 도착한 예전 결과를 보여 주지 않도록, 화면의 최신 값을 ref에 담아 두고 비교합니다.
  const latestAnalysisRef = useRef(analysis);
  const latestAnswerRef = useRef(answer);
  latestAnalysisRef.current = analysis;
  latestAnswerRef.current = answer;

  useEffect(() => {
    const loadIssue = async () => {
      try {
        const context = await view.getContext();
        const issueKey = context.extension?.issue?.key;

        if (!issueKey) {
          throw new Error('Issue key not found.');
        }

        const response = await requestJira(
          `/rest/api/3/issue/${encodeURIComponent(issueKey)}?fields=summary,description`
        );

        if (!response.ok) {
          throw new Error(`Jira API error: ${response.status}`);
        }

        setIssue(await response.json());
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    loadIssue();
  }, []);

  const handleAnalyze = async () => {
    if (!issue || analyzing) return;

    setAnalyzing(true);
    setAnalysis(false);
    setFeedback(null);
    setSaveMessage('');
    setError('');

    try {
      const result = await invoke('analyzeIssue', {
        issueKey: issue.key
      });

      setAnalysis(result);
    } catch (err) {
      setError(err.message || 'AI 분석 중 오류가 발생했습니다.');
    } finally {
      setAnalyzing(false);
    }
  };

  
  /**
   * 사용자 답변을 AI(Groq)로 평가합니다 (WBS 2.6 / DFAS-138).
   *
   * - 실제 평가는 백엔드 resolver의 evaluateAnswer가 합니다 (src/evaluation/).
   *   백엔드는 Jira 이슈를 다시 조회해서 평가 근거로 쓰므로, 여기서는 이슈 내용을 보내지 않습니다.
   * - 성공하면 { scores, total, level, feedback, improvement, unverifiedClaims }를 받습니다.
   * - 실패하면 백엔드가 준 안전한 안내 문구만 보여 주고, 결과는 표시하지 않습니다.
   */
  const handleFeedback = async () => {
    if (!issue || !analysis || evaluating) return;

    // 빈 답변은 백엔드에서도 거부하지만, 불필요한 호출을 줄이려고 먼저 확인합니다.
    if (!answer.trim()) {
      setError('답변을 입력해 주세요.');
      return;
    }

    // 요청을 보낸 시점의 값입니다. 응답이 왔을 때 화면의 최신 값과 비교합니다.
    const requestedAnalysis = analysis;
    const requestedAnswer = answer;
    const isStale = () =>
      latestAnalysisRef.current !== requestedAnalysis ||
      latestAnswerRef.current !== requestedAnswer;

    setEvaluating(true);
    setFeedback(null);
    setSaveMessage('');
    setError('');

    try {
      const result = await invoke('evaluateAnswer', {
        issueKey: issue.key,
        analysis: requestedAnalysis,
        question: requestedAnalysis.question,
        answer: requestedAnswer
      });

      // 평가하는 동안 이슈를 다시 분석했거나 답변을 고쳤다면 예전 결과는 버립니다.
      if (!isStale()) {
        setFeedback(result);
      }
    } catch (err) {
      if (!isStale()) {
        setError(err.message || 'AI 평가 중 오류가 발생했습니다.');
      }
    } finally {
      setEvaluating(false);
    }
  };

const handleSaveToJira = async () => {
  if (!issue || !feedback || saving) return;

  setSaving(true);
  setSaveMessage('');

  try {
    const commentText = [
      '[Decision Context Coach - Mock Evaluation]',
      '',
      `Issue: ${issue.key}`,
      `Title: ${issue.fields.summary}`,
      '',
      'Suggested Decision (Groq AI):',
      analysis.decision,
      '',
      'Potential Risk (Groq AI):',
      analysis.risk,
      '',
      'Technical Considerations:',
      analysis.technicalConsiderations,
      '',
      'Missing Information:',
      analysis.missingInformation,
      '',
      'Technical Question:',
      analysis.question,
      '',
      'User Answer:',
      answer,
      '',
      `Evaluation: ${feedback.level}`,
      `Total: ${feedback.total} / 12`,
      `Accuracy: ${feedback.scores.accuracy} / 4`,
      `Evidence: ${feedback.scores.evidence} / 4`,
      `Explanation: ${feedback.scores.explanation} / 4`,
      '',
      `Feedback: ${feedback.feedback}`,
      `Improvement: ${feedback.improvement}`,
      '',
      'Unverified Claims (Jira):',
      feedback.unverifiedClaims.length > 0
        ? feedback.unverifiedClaims.map(claim => `- ${claim}`).join('\n')
        : 'None',
      '',
      'Disclaimer: AI-generated analysis and evaluation based only on Jira issue text.',
      'Scores are learning feedback, not verified facts about the code.'
    ].join('\n');

    const response = await requestJira(
      `/rest/api/3/issue/${encodeURIComponent(issue.key)}/comment`,
      {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          body: {
            type: 'doc',
            version: 1,
            content: [
              {
                type: 'paragraph',
                content: [
                  {
                    type: 'text',
                    text: commentText
                  }
                ]
              }
            ]
          }
        })
      }
    );

    if (!response.ok) {
      throw new Error(
        `Jira comment failed: ${response.status}`
      );
    }

    setSaveMessage('Saved to Jira successfully.');
  } catch (err) {
    setSaveMessage(
      `Save failed: ${err.message}`
    );
  } finally {
    setSaving(false);
  }
};


  const mockResult = issue ? createMockAnalysis(issue) : null;
  

  return (
    <Stack space="space.200">
      <Heading size="medium">Decision Context Coach</Heading>
      <Text>AI analysis: Groq | Answer evaluation: Groq AI</Text>
      {error && (
        <SectionMessage appearance="error">
          <Text>{error}</Text>
        </SectionMessage>
      )}

      {issue && (
        <>
          <Text>Issue: {issue.key}</Text>
          <Text>Title: {issue.fields.summary}</Text>

          <Button
            appearance="primary"
            onClick={handleAnalyze}
          >
            Analyze Issue
          </Button>
        </>
      )}

      {analyzing && <Spinner />}

      {analysis && mockResult && (
        <>
          
      
<Heading size="small">1. Decision Card</Heading>

<Stack space="space.200">
  <Heading size="small">Verified Jira Context</Heading>

  <Text>Issue Key: {issue.key}</Text>
  <Text>Issue Title: {issue.fields.summary}</Text>

  <Heading size="small">Issue Description</Heading>

  {mockResult.hasDescription ? (
    <Text>{mockResult.descriptionText.slice(0, 1500)}</Text>
  ) : (
    <Text>No description provided in Jira.</Text>
  )}

  <Heading size="small">Suggested Decision (Groq AI)</Heading>
  <Text>{analysis.decision}</Text>

  <Heading size="small">Potential Risk (Groq AI)</Heading>
  <Text>{analysis.risk}</Text>

  <Heading size="small">Technical Considerations (Groq AI)</Heading>
  <Text>{analysis.technicalConsiderations}</Text>

  <Heading size="small">Missing Information (Groq AI)</Heading>
  <Text>{analysis.missingInformation}</Text>

  
  <Text>
    Disclaimer: Jira context is retrieved from the issue.
    Decisions, risks, and questions are AI-generated suggestions,
    not independently verified conclusions.
  </Text>
</Stack>


      <Heading size="small">2. Technical Question</Heading>

        <Text>{analysis.question || 'AI가 기술 질문을 생성하지 못했습니다.'}</Text>

        <Heading size="small">3. Your Answer</Heading>
        <TextArea
          value={answer}
          onChange={(event) => {
            setAnswer(event.target.value);
            setFeedback(null);
          }}
          placeholder="Write your technical reasoning..."
        />

        <Button onClick={handleFeedback} isDisabled={evaluating || !answer.trim()}>
          {evaluating ? 'Evaluating...' : 'Evaluate Answer'}
        </Button>

        {evaluating && <Spinner />}
      </>
    )}

    {feedback && (
      <>
        <Heading size="small">4. AI Feedback (Groq)</Heading>

        {/* 총점과 등급은 백엔드가 계산한 값을 그대로 표시합니다 (api-contract.md 5절). */}
        <Text>Total: {feedback.total} / 12 ({feedback.level})</Text>
        <Text>Accuracy (정확성): {feedback.scores.accuracy} / 4</Text>
        <Text>Evidence (근거): {feedback.scores.evidence} / 4</Text>
        <Text>Explanation (설명 충실도): {feedback.scores.explanation} / 4</Text>

        <Text>Feedback: {feedback.feedback}</Text>
        <Text>Improvement: {feedback.improvement}</Text>

        {/* Jira 이슈로 확인할 수 없는 주장은 사실처럼 보이지 않도록 따로 표시합니다. */}
        <Text>Unverified claims (Jira로 확인 불가):</Text>
        {feedback.unverifiedClaims.length > 0 ? (
          feedback.unverifiedClaims.map((claim, index) => (
            <Text key={index}>- {claim}</Text>
          ))
        ) : (
          <Text>None</Text>
        )}

        <Text>
          Note: AI-generated evaluation based only on the Jira issue text.
          Scores are learning feedback, not verified facts about the code.
        </Text>
        <Button
          appearance="primary"
          onClick={handleSaveToJira}
          isDisabled={saving}
        >
          {saving ? 'Saving...' : 'Save to Jira'}
        </Button>

        {saveMessage && (
          <Text>{saveMessage}</Text>
        )}
      </>
    )}

    </Stack>
  );
};

ForgeReconciler.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);