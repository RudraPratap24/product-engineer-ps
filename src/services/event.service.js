import {
  createEvent,
  findEventByEventId
} from "../repositories/event.repository.js";

import { deliveryQueue } from "../queue/delivery.queue.js";

export async function ingestEvent(input) {
  const existingEvent = await findEventByEventId(input.eventId);

  if (existingEvent) {
    return {
      event: existingEvent,
      duplicate: true
    };
  }

  try {
    const event = await createEvent({
      eventId: input.eventId,
      type: input.type,
      occurredAt: new Date(input.occurredAt),
      payload: input.payload,
      status: "PENDING",
      nextAttemptAt: new Date()
    });

    await deliveryQueue.add(
      "deliver-webhook",
      {
        eventId: event.eventId,
        attemptNumber: 1
      },
      {
        jobId: `${event.eventId}:attempt:1`
      }
    );

    return {
      event,
      duplicate: false
    };
  } catch (error) {
    // The UNIQUE constraint is the final protection
    // against concurrent duplicate ingestion.
    if (error.code === "23505") {
      const existingEvent = await findEventByEventId(
        input.eventId
      );

      if (existingEvent) {
        return {
          event: existingEvent,
          duplicate: true
        };
      }
    }

    throw error;
  }
}