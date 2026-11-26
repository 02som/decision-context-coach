
import React, { useEffect, useRef, useState } from 'react';
import ForgeReconciler, {
  Text,
  Heading,
  Stack,
  Button,
  TextArea,
  Spinner,
  SectionMessage,
  Box,
  Inline,
  Lozenge,
  Icon,
  Image,
  xcss
} from '@forge/react';

import { requestJira, view, invoke } from '@forge/bridge';
import appIcon from '../../../static/icons/icon.png';

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
// Decision Context Coach UI styles

const cardStyle = xcss({
  backgroundColor: 'elevation.surface.raised',
  borderColor: 'color.border',
  borderWidth: 'border.width',
  borderStyle: 'solid',
  borderRadius: 'radius.large',
  padding: 'space.200'
});

const accentCardStyle = xcss({
  backgroundColor: 'elevation.surface.raised',
  borderColor: 'color.border',
  borderWidth: 'border.width',
  borderStyle: 'solid',
  borderRadius: 'radius.medium',
  padding: 'space.150'
});

const insetStyle = xcss({
  backgroundColor: 'color.background.neutral',
  borderRadius: 'radius.medium',
  padding: 'space.200'
});

const tileStyle = xcss({
  borderColor: 'color.border',
  borderWidth: 'border.width',
  borderStyle: 'solid',
  borderRadius: 'radius.medium',
  padding: 'space.150',
  width: '100%',
  minWidth: '0px',
  flexGrow: 1
});

const trackStyle = xcss({
  backgroundColor: 'color.background.neutral',
  borderRadius: 'radius.small',
  height: '10px',
  width: '100%',
  overflow: 'hidden'
});

const scoreColors = [
  'color.background.neutral',
  'color.background.accent.magenta.subtlest',
  'color.background.accent.magenta.subtler',
  'color.background.accent.magenta.subtle',
  'color.background.accent.magenta.bolder'
];

const InfoTile = ({ title, content }) => {
  const icons = {
    'AI 제안': {
      glyph: 'lightbulb',
      color: 'color.icon.accent.magenta'
    },
    '잠재적 위험': {
      glyph: 'warning',
      color: 'color.icon.warning'
    },
    '기술적 고려 사항': {
      glyph: 'settings',
      color: 'color.icon.accent.blue'
    },
    '미확인 정보': {
      glyph: 'information',
      color: 'color.icon.subtle'
    }
  };

  const icon = icons[title] || {
    glyph: 'information',
    color: 'color.icon.subtle'
  };

  return (
    <Box xcss={tileStyle}>
      <Stack space="space.100">
        <Inline
          space="space.100"
          alignBlock="center"
        >
          <Icon
            glyph={icon.glyph}
            color={icon.color}
            size="medium"
            label=""
          />
          <Text weight="bold">{title}</Text>
        </Inline>

        <Text>{content || '확인 불가'}</Text>
      </Stack>
    </Box>
  );
};

const ScoreBar = ({ label, score }) => {
  const value = Math.max(
    0, Math.min(4, Number(score) || 0)
  );

  const fillStyle = xcss({
    backgroundColor: scoreColors[value],
    width: `${value * 25}%`,
    height: '10px',
    borderRadius: 'radius.small'
  });

  return (
    <Stack space="space.050">
      <Inline spread="space-between">
        <Text>{label}</Text>
        <Text weight="bold">{value}/4</Text>
      </Inline>

      <Box xcss={trackStyle}>
        <Box xcss={fillStyle} />
      </Box>
    </Stack>
  );
};

// 기존 AI 응답의 결정 정보 분리
const parseDecision = (decision) => {
  const source = String(decision || '');

  const evidence = source.match(
    /Jira\s*근거\s*:\s*([\s\S]*?)(?=\/?\s*기술 선택 상태\s*:|\/?\s*AI 제안\s*:|$)/
  );

  const status = source.match(
    /기술 선택 상태\s*:\s*([\s\S]*?)(?=\/?\s*AI 제안\s*:|$)/
  );

  const suggestion = source.match(
    /AI 제안\s*:\s*([\s\S]*)/
  );

  return {
    evidence: evidence?.[1]?.trim() || null,
    status: status?.[1]?.trim() || null,
    suggestion: suggestion?.[1]?.trim() || source
  };
};

const DecisionCard = ({ analysis, issue, description }) => {
  const [expanded, setExpanded] = useState(false);
  const decision = parseDecision(analysis.decision);
  const isUndecided =
  !decision.status ||
  /확인\s*불가|미확정|미결정|알 수 없음/.test(
    decision.status
  );
  return (
    <Box xcss={accentCardStyle}>
      <Stack space="space.100">
        <Inline space="space.100" alignBlock="center" alignInline="start">
        <Box xcss={xcss({
          width: '20px',
          flexShrink: 0
        })}>
          <Image
            src={appIcon}
            alt="Decision Context Coach logo"
            width="40px"
          />
        </Box>
        <Heading size="medium">Decision Card</Heading>
      </Inline>
        <Text color="color.text.subtle">
          {issue.key} · {issue.fields.summary}
        </Text>

        <Box xcss={insetStyle}>
          <Inline spread="space-between" alignBlock="center">
            <Text weight="bold" color="color.text.accent.magenta">
              TECHNICAL DECISION
            </Text>

            {isUndecided && (
              <Lozenge appearance="moved">
                결정 미확정
              </Lozenge>
            )}
          </Inline>

          <Heading size="large">
            {isUndecided
              ? '기술 선택 검토 필요'
              : decision.status}
          </Heading>
        </Box>

        <Box xcss={cardStyle}>
          <Stack space="space.100">
            <Text weight="bold">Jira 근거 (AI 추출)</Text>
            <Text>{decision.evidence || '확인 불가'}</Text>
          </Stack>
        </Box>

        <Inline space="space.100" grow="fill">
          <InfoTile
            title="AI 제안"
            content={decision.suggestion}
          />

          <InfoTile
            title="잠재적 위험"
            content={analysis.risk}
          />
        </Inline>

        <Inline space="space.100" grow="fill">
          <InfoTile
            title="기술적 고려 사항"
            content={analysis.technicalConsiderations}
          />

          <InfoTile
            title="미확인 정보"
            content={analysis.missingInformation}
          />
        </Inline>

        <Button
          appearance="subtle"
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? '▲ Jira 원문 접기' : '▼ Jira 원문 보기'}
        </Button>

        {expanded && (
          <Box xcss={insetStyle}>
            <Stack space="space.100">
              <Text weight="bold">Verified Jira Context</Text>
              <Text>
                {description || 'No description provided in Jira.'}
              </Text>
            </Stack>
          </Box>
        )}

        <Text color="color.text.subtle" size="small">
          AI-generated analysis based on Jira context.
          Not independently verified conclusions.
        </Text>

      </Stack>
    </Box>
  );
};

const LearningFeedback = ({ feedback }) => {
  const appearance =
    feedback.level === 'Strong'
      ? 'success'
      : feedback.level === 'Needs improvement'
        ? 'moved'
        : 'removed';

  const totalFillStyle = xcss({
    backgroundColor:
      scoreColors[Math.ceil(feedback.total / 3)],
    width: `${feedback.total / 12 * 100}%`,
    height: '10px',
    borderRadius: 'radius.small'
  });

  return (
    <Box xcss={accentCardStyle}>
      <Stack space="space.200">
        <Inline space="space.100" alignBlock="center">
        <Icon
          glyph="chart-bar"
          color="color.icon.accent.magenta"
          size="medium"
          label=""
        />
        <Heading size="medium">
          AI Learning Feedback
        </Heading>
      </Inline>

        <Inline space="space.200" grow="fill">

          <Box xcss={tileStyle}>
            <Stack
              space="space.100"
              alignInline="center"
            >
              <Text color="color.text.subtle">
                TOTAL SCORE
              </Text>

              <Heading size="xxlarge">
                {feedback.total}/12
              </Heading>

              <Lozenge appearance={appearance}>
                {feedback.level}
              </Lozenge>

              <Box xcss={trackStyle}>
                <Box xcss={totalFillStyle} />
              </Box>
            </Stack>
          </Box>

          <Box xcss={tileStyle}>
            <Stack space="space.150">

              <ScoreBar
                label="Accuracy"
                score={feedback.scores.accuracy}
              />

              <ScoreBar
                label="Evidence"
                score={feedback.scores.evidence}
              />

              <ScoreBar
                label="Explanation"
                score={feedback.scores.explanation}
              />

            </Stack>
          </Box>
        </Inline>

        <Box xcss={insetStyle}>
          <Stack space="space.200">

            <Stack space="space.100">
              <Heading size="small">AI 피드백</Heading>
              <Text>{feedback.feedback}</Text>
            </Stack>

            <Stack space="space.100">
              <Heading size="small">개선 방향</Heading>
              <Text>{feedback.improvement}</Text>
            </Stack>

          </Stack>
        </Box>

        <Box xcss={cardStyle}>
          <Stack space="space.100">
            <Text weight="bold">
              미확인 주장 (Jira)
            </Text>

            {feedback.unverifiedClaims.length > 0
              ? feedback.unverifiedClaims.map(
                  (claim, index) => (
                    <Text key={index}>- {claim}</Text>
                  )
                )
              : <Text>None</Text>}
          </Stack>
        </Box>

        <Text size="small" color="color.text.subtle">
          AI-generated learning feedback.
          Scores are not verified facts about the code.
        </Text>

      </Stack>
    </Box>
  );
};

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
      '[Decision Context Coach - Groq AI Evaluation]',      '',
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
      <Box xcss={accentCardStyle}>
        <Stack space="space.100">
          <Inline
            space="space.050"
            alignBlock="center"
            alignInline="start"
            grow="hug"
          >
            <Box xcss={xcss({
              width: '40px',
              flexShrink: 0
            })}>
              <Image
                src={appIcon}
                alt="Decision Context Coach logo"
                width="40px"
              />
            </Box>

            <Heading size="medium">
              Decision Context Coach
            </Heading>
          </Inline>
          <Text color="color.text.subtle">
            Understand decisions. Build technical reasoning.
          </Text>

          <Inline space="space.100">
            <Lozenge appearance="new">Groq AI</Lozenge>
            <Lozenge appearance="default">Jira Context</Lozenge>
          </Inline>
        </Stack>
      </Box>
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
            iconBefore="lightbulb"
            onClick={handleAnalyze}
            isDisabled={analyzing}
          >
            {analyzing ? 'Analyzing...' : 'Analyze Issue'}
          </Button>
        </>
      )}

      {analyzing && <Spinner />}

      {analysis && mockResult && (
        <>
          
      <DecisionCard
        analysis={analysis}
        issue={issue}
        description={mockResult.descriptionText}
      />

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

        <Button
          iconBefore="chart-bar"
          onClick={handleFeedback}
          isDisabled={evaluating || !answer.trim()}
        >
          {evaluating ? 'Evaluating...' : 'Evaluate Answer'}
        </Button>

        {evaluating && <Spinner />}
      </>
    )}

    {feedback && (
      <>
      <LearningFeedback feedback={feedback} />

        <Button
          appearance="primary"
          iconBefore="check-circle"
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