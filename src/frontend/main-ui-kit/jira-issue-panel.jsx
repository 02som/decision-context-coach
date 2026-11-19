
import React, { useEffect, useState } from 'react';
import ForgeReconciler, {
  Text,
  Heading,
  Stack,
  Box,
  Button,
  TextArea,
  Spinner,
  SectionMessage
} from '@forge/react';

import { requestJira, view } from '@forge/bridge';


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



const normalizeTechnicalTerms = (text) => {
  const normalized = String(text || '').toLowerCase();

  const termGroups = {
    api: ['api', 'rest api', '인터페이스'],
    llm: ['llm', 'language model', '언어 모델', '언어모델'],
    integration: ['integration', 'integrate', '연동', '통합'],
    security: ['security', 'secure', '보안', '인증'],
    error: ['error', 'failure', '오류', '실패'],
    testing: ['test', 'testing', '테스트', '검증'],
    context: ['context', '맥락', '문맥'],
    feedback: ['feedback', '피드백'],
    question: ['question', '질문']
  };

  const found = new Set();

  for (const [term, variants] of Object.entries(termGroups)) {
    if (variants.some((variant) => normalized.includes(variant))) {
      found.add(term);
    }
  }

  return [...found];
};

const evaluateMockAnswer = (answer, issue) => {
  const text = answer.trim();
  const lower = text.toLowerCase();

  const evidenceWords = [
    'because', '근거', '이유', '때문',
    'based on', 'according to'
  ];

  const technicalWords = [
    'api', 'database', 'error', 'security',
    'performance', 'test', 'risk',
    '설계', '오류', '보안', '성능',
    '테스트', '위험', '데이터'
  ];

  const hasEvidence = evidenceWords.some(
    (word) => lower.includes(word)
  );

  const hasTechnicalDetail = technicalWords.some(
    (word) => lower.includes(word)
  );

  const isDetailed = text.length >= 80;

  
// Compare the answer with Jira title and description.
const title = issue?.fields?.summary || '';
const description = extractJiraText(
  issue?.fields?.description
);

const jiraText = `${title}\n${description}`;

const jiraTerms = normalizeTechnicalTerms(jiraText);
const answerTerms = normalizeTechnicalTerms(text);

const matchedWords = jiraTerms.filter(
  (term) => answerTerms.includes(term)
);

const hasJiraRelevance = matchedWords.length >= 2;

  const score =
    Number(hasEvidence) +
    Number(hasTechnicalDetail) +
    Number(isDetailed) +
    Number(hasJiraRelevance);

  const level =
    score >= 4
      ? 'Strong'
      : score >= 2
        ? 'Needs improvement'
        : 'Insufficient';

  const improvements = [];

  if (!hasEvidence) {
    improvements.push('Explain why you chose this approach.');
  }

  if (!hasTechnicalDetail) {
    improvements.push('Include technical details and risks.');
  }

  if (!isDetailed) {
    improvements.push('Provide a more detailed explanation.');
  }

  if (!hasJiraRelevance) {
    improvements.push('Connect your answer to the Jira issue.');
  }

  return {
    level,
    score,
    matchedWords,
    message: hasJiraRelevance
      ? 'Your answer mentions terms from the Jira issue.'
      : 'No matching issue-title terms were detected.',
    improvement: improvements.length > 0
      ? improvements.join(' ')
      : 'Explain trade-offs and cite specific Jira evidence.'
  };
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

  const handleAnalyze = () => {
    setAnalysis(true);
    setFeedback(null);
  };

  
  const handleFeedback = () => {
    if (!answer.trim()) {
      setError('Please enter your answer first.');
      return;
    }

    setError('');
    const result = evaluateMockAnswer(answer, issue);
    setFeedback(result);
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
      'Suggested Decision (Mock):',
      mockResult.decision,
      '',
      'Potential Risk (Mock):',
      mockResult.risk,
      '',
      'Technical Question:',
      mockResult.question,
      '',
      'User Answer:',
      answer,
      '',
      `Evaluation: ${feedback.level}`,
      `Score: ${feedback.score} / 4`,
      `Matched Jira Terms: ${
        feedback.matchedWords.join(', ') || 'None'
      }`,
      `Improvement: ${feedback.improvement}`,
      '',
      'Disclaimer: Rule-based mock evaluation.',
      'Factual correctness has not been verified.'
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
  
  if (loading) return <Spinner />;

  return (
    <Stack space="space.200">
      <Heading size="medium">Decision Context Coach</Heading>
      <Text>Demo mode: Mock AI (no API cost)</Text>

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

  <Heading size="small">Suggested Decision (Mock)</Heading>
  <Text>{mockResult.decision}</Text>

  <Heading size="small">Potential Risk (Mock)</Heading>
  <Text>{mockResult.risk}</Text>

  <Heading size="small">Missing Information</Heading>

  {!mockResult.hasDescription ? (
    <Text>
      The issue description is missing.
      Add requirements, constraints, and acceptance criteria.
    </Text>
  ) : (
    <Text>
      Technical constraints and acceptance criteria
      have not been independently verified.
    </Text>
  )}

  <Text>
    Disclaimer: Jira context is retrieved from the issue.
    Decisions and risks are predefined suggestions,
    not verified conclusions.
  </Text>
</Stack>


      <Heading size="small">2. Technical Question</Heading>

        <Text>{mockResult.question}</Text>

        <Heading size="small">3. Your Answer</Heading>
        <TextArea
          value={answer}
          onChange={(event) => {
            setAnswer(event.target.value);
            setFeedback(null);
          }}
          placeholder="Write your technical reasoning..."
        />

        <Button onClick={handleFeedback}>
          Evaluate Answer
        </Button>
      </>
    )}

    {feedback && (
      <>
        <Heading size="small">4. Mock Feedback</Heading>

        <Text>Score: {feedback.score} / 4</Text>
        <Text>
          Matched Jira terms: {feedback.matchedWords.join(', ') || 'None'}
        </Text>
        <Text>{feedback.message}</Text>
        <Text>Improvement: {feedback.improvement}</Text>

        <Text>
          Note: This is rule-based feedback.
          Factual correctness has not been verified.
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
  )};
;

ForgeReconciler.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);