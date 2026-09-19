import "dotenv/config";

import {
  updateEvent,
  claimEventForDelivery,
} from "../repositories/event.repository.js";

import {
  createAttempt,
  completeAttempt,
} from "../repositories/attempt.repository.js";

import {
  isRetryableStatus,
  calculateRetryDelay,
} from "../domain/retry-policy.js";

import { postWebhook } from "../infrastructure/http-client.js";

import {
  logDelivery,
  logRetry,
  logSkip,
  logFailed,
} from "../utils/logger.js";

export async function deliverEvent(
  eventId,
  expectedAttemptNumber
) {
  const claimedEvent = await claimEventForDelivery(
    eventId,
    expectedAttemptNumber
  );

  // Another worker already claimed this event,
  // or this job is stale/duplicate.
  if (!claimedEvent) {
    logSkip(
      `event=${eventId} attempt=${expectedAttemptNumber} reason=not_eligible`
    );

    return {
      skipped: true,
      eventId,
    };
  }

  const attemptNumber = expectedAttemptNumber;

  const maxAttempts = Number(
    process.env.MAX_ATTEMPTS || 5
  );

  const attempt = await createAttempt(
    claimedEvent.id,
    attemptNumber
  );

  const result = await postWebhook(
    process.env.WEBHOOK_URL,
    claimedEvent.payload,
    Number(process.env.REQUEST_TIMEOUT_MS || 3000)
  );

  await completeAttempt(attempt.id, result);

  // Successful delivery
  if (result.ok) {
    const event = await updateEvent(eventId, {
      status: "SUCCEEDED",
      nextAttemptAt: null,
      deliveryStartedAt: null,
    });

    logDelivery(
      `event=${eventId} attempt=${attemptNumber} http=${result.status} result=SUCCEEDED`
    );

    return {
      skipped: false,
      event,
    };
  }

  const retryable =
    result.status === null ||
    isRetryableStatus(result.status);

  // Terminal failure OR retry limit reached
  if (!retryable || attemptNumber >= maxAttempts) {
    const event = await updateEvent(eventId, {
      status: "FAILED",
      nextAttemptAt: null,
      deliveryStartedAt: null,
    });

    if (!retryable) {
      logFailed(
        `event=${eventId} attempt=${attemptNumber} http=${result.status} reason=non_retryable_status`
      );
    } else {
      logFailed(
        `event=${eventId} attempt=${attemptNumber} http=${result.status} reason=max_attempts_reached attempts=${maxAttempts}`
      );
    }

    return {
      skipped: false,
      event,
    };
  }

  const delay = calculateRetryDelay(attemptNumber);

  const event = await updateEvent(eventId, {
    status: "RETRYING",
    nextAttemptAt: new Date(Date.now() + delay),
    deliveryStartedAt: null,
  });

  logDelivery(
    `event=${eventId} attempt=${attemptNumber} http=${result.status ?? "NETWORK_ERROR"} result=FAILED`
  );

  logRetry(
    `event=${eventId} attempt=${attemptNumber} next_attempt=${attemptNumber + 1} delay=${delay / 1000}s`
  );

  return {
    skipped: false,
    event,
  };
}