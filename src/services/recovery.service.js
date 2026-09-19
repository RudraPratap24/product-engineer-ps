import "dotenv/config";

import {
  findStaleDeliveringEvents,
  recoverStaleEvent,
  findEventsReadyForDispatch,
} from "../repositories/event.repository.js";

import { getLatestAttemptNumber } from "../repositories/attempt.repository.js";
import { deliveryQueue } from "../queue/delivery.queue.js";

async function enqueueAttempt(
  event,
  attemptNumber,
  delay = 0
) {
  const jobId =
    `${event.eventId}:attempt:${attemptNumber}`;

  const existingJob =
    await deliveryQueue.getJob(jobId);

  if (existingJob) {
    return false;
  }

  await deliveryQueue.add(
    "deliver-webhook",
    {
      eventId: event.eventId,
      attemptNumber,
    },
    {
      jobId,
      delay,
    }
  );

  return true;
}

export async function recoverStaleDeliveries() {
  const leaseTimeoutMs = Number(
    process.env.DELIVERY_LEASE_TIMEOUT_MS ||
      30000
  );

  const cutoff = new Date(
    Date.now() - leaseTimeoutMs
  );

  const staleEvents =
    await findStaleDeliveringEvents(
      leaseTimeoutMs
    );

  for (const event of staleEvents) {
    const recoveredEvent =
      await recoverStaleEvent(
        event.eventId,
        cutoff
      );

    if (!recoveredEvent) {
      continue;
    }

    const latestAttemptNumber =
      await getLatestAttemptNumber(
        event.id
      );

    const nextAttemptNumber =
      latestAttemptNumber + 1;

    const queued = await enqueueAttempt(
      event,
      nextAttemptNumber
    );

    if (queued) {
      console.log(
        `[RECOVERY] event=${event.eventId} ` +
        `next_attempt=${nextAttemptNumber} ` +
        `reason=stale_delivery`
      );
    }
  }

  return staleEvents.length;
}

export async function dispatchPendingEvents() {
  const eventsReadyForDispatch =
    await findEventsReadyForDispatch();

  for (const event of eventsReadyForDispatch) {
    const latestAttemptNumber =
      await getLatestAttemptNumber(
        event.id
      );

    const nextAttemptNumber =
      latestAttemptNumber + 1;

    const maxAttempts = Number(
      process.env.MAX_ATTEMPTS || 5
    );

    if (nextAttemptNumber > maxAttempts) {
      continue;
    }

    const delay =
      event.nextAttemptAt
        ? Math.max(
            0,
            new Date(
              event.nextAttemptAt
            ).getTime() - Date.now()
          )
        : 0;

    const queued = await enqueueAttempt(
      event,
      nextAttemptNumber,
      delay
    );

    if (queued) {
      console.log(
        `[DISPATCH] event=${event.eventId} ` +
        `attempt=${nextAttemptNumber} ` +
        `reason=${event.status.toLowerCase()}`
      );
    }
  }
}
