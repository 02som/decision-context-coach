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
        'AI analysis timed out. Please try again later.'
      );
    }

    throw new Error(
      'Unable to connect to the AI service. Please try again later.'
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
        'Too many AI requests. Please try again later.'
      );
    }

    throw new Error(
      'AI analysis request failed. Please try again later.'
    );
  }

  let result;

  try {
    result = JSON.parse(rawResponse);
  } catch {
    throw new Error(
      'Invalid AI service response format.'
    );
  }

  const content = result?.choices?.[0]?.message?.content;

  if (typeof content !== 'string' || !content.trim()) {
    throw new Error(
      'AI analysis returned an empty or invalid result.'
    );
  }

  return content;
}