export async function postWebhook(url, payload, timeoutMs) {
  const controller = new AbortController();

  const timeout = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  const startedAt = Date.now();

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    });

    return {
      ok: response.ok,
      status: response.status,
      durationMs: Date.now() - startedAt
    };
  } catch (error) {
    return {
      ok: false,
      status: null,
      error: error.name === "AbortError"
        ? "Request timed out"
        : error.message,
      durationMs: Date.now() - startedAt
    };
  } finally {
    clearTimeout(timeout);
  }
}