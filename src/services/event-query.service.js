import { findEventByEventId } from "../repositories/event.repository.js";
import { getAttemptsForEvent } from "../repositories/attempt.repository.js";

export async function getEventDetails(eventId) {
  const event = await findEventByEventId(eventId);

  if (!event) {
    return null;
  }

  const attempts = await getAttemptsForEvent(event.id);

  return {
    eventId: event.eventId,
    type: event.type,
    occurredAt: event.occurredAt,
    payload: event.payload,
    status: event.status,
    nextAttemptAt: event.nextAttemptAt,
    createdAt: event.createdAt,
    updatedAt: event.updatedAt,

    attempts: attempts.map((attempt) => ({
      attemptNumber: attempt.attemptNumber,
      status: attempt.status,
      httpStatus: attempt.httpStatus,
      error: attempt.error,
      startedAt: attempt.startedAt,
      completedAt: attempt.completedAt,
      durationMs: attempt.durationMs
    }))
  };
}