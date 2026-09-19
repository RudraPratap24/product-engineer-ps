const RETRYABLE_STATUS_CODES = new Set([
  408,
  425,
  429,
  500,
  502,
  503,
  504
]);

export function isRetryableStatus(status) {
  return RETRYABLE_STATUS_CODES.has(status);
}

export function calculateRetryDelay(attemptNumber) {
  const baseDelay = Number(process.env.RETRY_BASE_DELAY_MS || 1000);

  return baseDelay * 2 ** (attemptNumber - 1);
}

