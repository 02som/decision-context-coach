export async function requestGroqAnalysis({
  fetchFn,
  url,
  options,
  timeoutMs = 20000
}) {
  let response;
  let rawResponse;
  let timeoutId;

  try {
    const request = async () => {
      response = await fetchFn(url, options);
      rawResponse = await response.text();
    };

    await Promise.race([
      request(),
      new Promise((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(new Error('GROQ_TIMEOUT'));
        }, timeoutMs);
      })
    ]);
  } catch (error) {
    if (error?.message === 'GROQ_TIMEOUT') {
      throw new Error(
        'AI 분석 응답 시간이 초과되었습니다. 잠시 후 다시 시도해 주세요.'
      );
    }

    throw new Error(
      'AI 서비스에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.'
    );
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    console.error('[analyzeIssue] Groq request failed', {
      status: response.status
    });

    if (response.status === 429) {
      throw new Error(
        'AI 서비스 요청이 많습니다. 잠시 후 다시 시도해 주세요.'
      );
    }

    throw new Error(
      'AI 분석 요청에 실패했습니다. 잠시 후 다시 시도해 주세요.'
    );
  }

  let result;

  try {
    result = JSON.parse(rawResponse);
  } catch {
    throw new Error(
      'AI 서비스 응답 형식이 올바르지 않습니다.'
    );
  }

  const content = result?.choices?.[0]?.message?.content;

  if (typeof content !== 'string' || !content.trim()) {
    throw new Error(
      'AI 분석 결과가 비어 있거나 올바르지 않습니다.'
    );
  }

  return content;
}