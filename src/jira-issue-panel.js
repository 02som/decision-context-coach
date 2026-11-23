
import React, { useEffect, useState } from 'react';
import ForgeReconciler, {
  Text,
  Heading,
  Stack,
  SectionMessage,
  Spinner
} from '@forge/react';
import { requestJira, view } from '@forge/bridge';

const App = () => {
  const [issue, setIssue] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const loadIssue = async () => {
      try {
        const context = await view.getContext();
        const issueKey = context.extension?.issue?.key;

        if (!issueKey) {
          throw new Error('Jira 이슈 키를 찾을 수 없습니다.');
        }

        const response = await requestJira(
          `/rest/api/3/issue/${encodeURIComponent(issueKey)}?fields=summary,description`
        );

        if (!response.ok) {
          throw new Error(`Jira API 오류: ${response.status}`);
        }

        const data = await response.json();
        setIssue(data);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    loadIssue();
  }, []);

  if (loading) {
    return <Spinner />;
  }

  if (error) {
    return (
      <SectionMessage appearance="error">
        <Text>{error}</Text>
      </SectionMessage>
    );
  }

  return (
    <Stack space="space.200">
      <Heading size="medium">Decision Context Coach</Heading>
      <Text>현재 Jira 이슈를 성공적으로 불러왔습니다.</Text>
      <Text>이슈 번호: {issue.key}</Text>
      <Text>이슈 제목: {issue.fields.summary}</Text>
      <Text>
        이슈 설명: {issue.fields.description
          ? '설명 데이터가 존재합니다.'
          : '등록된 설명이 없습니다.'}
      </Text>
    </Stack>
  );
};

ForgeReconciler.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);