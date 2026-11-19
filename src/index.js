
import React, { useEffect, useState } from 'react';
import ForgeReconciler, {
  Heading,
  Text,
  Stack,
  Spinner,
  useProductContext
} from '@forge/react';
import { requestJira } from '@forge/bridge';

const App = () => {
  const context = useProductContext();
  const issueKey = context?.extension?.issue?.key;

  const [issue, setIssue] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!issueKey) return;

    const loadIssue = async () => {
      try {
        const response = await requestJira(
          `/rest/api/3/issue/${encodeURIComponent(issueKey)}?fields=summary,description`
        );

        if (!response.ok) {
          throw new Error(`Jira API: ${response.status}`);
        }

        const data = await response.json();
        setIssue(data);
      } catch (err) {
        setError(err.message);
      }
    };

    loadIssue();
  }, [issueKey]);

  return (
    <Stack space="space.200">
      <Heading size="large">
        Decision Context Coach
      </Heading>

      <Text>현재 이슈: {issueKey || '불러오는 중'}</Text>

      {error && <Text>오류: {error}</Text>}

      {!issue && !error && <Spinner />}

      {issue && (
        <>
          <Heading size="medium">
            {issue.fields.summary}
          </Heading>
          <Text>Jira 이슈를 불러왔습니다.</Text>
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
