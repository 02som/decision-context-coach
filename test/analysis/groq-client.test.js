import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { requestGroqAnalysis } from '../../src/analysis/groq-client.js';

function run(fetchFn, timeoutMs = 1000) {
  return requestGroqAnalysis({
    fetchFn,
    url: 'https://api.groq.com/openai/v1/chat/completions',
    options: {},
    timeoutMs
  });
}

function mockResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body)
  };
}

describe('requestGroqAnalysis', () => {
  it('정상 응답 반환', async () => {
    const content = '{"decision":"테스트"}';

    const result = await run(async () =>
      mockResponse(200, {
        choices: [{ message: { content } }]
      })
    );

    assert.equal(result, content);
  });

  it('HTTP 500 오류 및 응답 원문 노출 방지', async () => {
    await assert.rejects(
      run(async () =>
        mockResponse(500, {
          error: 'internal-secret-test'
        })
      ),
      {
        message: 'AI analysis request failed. Please try again later.'
      }
    );
  });

  it('HTTP 429 요청 한도 초과', async () => {
    await assert.rejects(
      run(async () => mockResponse(429, {})),
      {
        message: 'Too many AI requests. Please try again later.'
      }
    );
  });

  it('네트워크 연결 실패', async () => {
    await assert.rejects(
      run(async () => {
        throw new Error('fetch failed');
      }),
      {
        message: 'Unable to connect to the AI service. Please try again later.'
      }
    );
  });

  it('응답 시간 초과', async () => {
    await assert.rejects(
      run(() => new Promise(() => {}), 30),
      {
        message: 'AI analysis timed out. Please try again later.'
      }
    );
  });

  it('빈 응답 처리', async () => {
    await assert.rejects(
      run(async () =>
        mockResponse(200, {
          choices: [{ message: { content: '' } }]
        })
      ),
      {
        message: 'AI analysis returned an empty or invalid result.'
      }
    );
  });

  it('공백 응답 처리', async () => {
    await assert.rejects(
      run(async () =>
        mockResponse(200, {
          choices: [{ message: { content: '   ' } }]
        })
      ),
      {
        message: 'AI analysis returned an empty or invalid result.'
      }
    );
  });

  it('잘못된 API 응답 형식 처리', async () => {
    await assert.rejects(
      run(async () => ({
        ok: true,
        status: 200,
        text: async () => 'not json'
      })),
      {
        message: 'Invalid AI service response format.'
      }
    );
  });
});