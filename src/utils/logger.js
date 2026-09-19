export function logDelivery(message) {
  console.log(`[DELIVERY] ${message}`);
}

export function logRetry(message) {
  console.log(`[RETRY]    ${message}`);
}

export function logSkip(message) {
  console.log(`[SKIP]     ${message}`);
}

export function logFailed(message) {
  console.log(`[FAILED]   ${message}`);
}