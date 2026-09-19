import { eq, and } from "drizzle-orm";
import { db } from "../infrastructure/database.js";
import { deliveryAttempts } from "../db/schema.js";

export async function createAttempt(eventId, attemptNumber) {
  const result = await db
    .insert(deliveryAttempts)
    .values({
      eventId,
      attemptNumber,
      status: "IN_PROGRESS"
    })
    .returning();

  return result[0];
}

export async function completeAttempt(
  attemptId,
  result
) {
  const update = {
    status: result.ok ? "SUCCEEDED" : "FAILED",
    httpStatus: result.status,
    error: result.error ?? null,
    completedAt: new Date(),
    durationMs: result.durationMs
  };

  const rows = await db
    .update(deliveryAttempts)
    .set(update)
    .where(eq(deliveryAttempts.id, attemptId))
    .returning();

  return rows[0];
}

export async function getLatestAttemptNumber(eventId) {
  const result = await db
    .select({
      attemptNumber: deliveryAttempts.attemptNumber
    })
    .from(deliveryAttempts)
    .where(eq(deliveryAttempts.eventId, eventId))
    .orderBy(deliveryAttempts.attemptNumber)
    ;

  if (result.length === 0) {
    return 0;
  }

  return result[result.length - 1].attemptNumber;
}


export async function getAttemptsForEvent(eventId) {
  return db
    .select()
    .from(deliveryAttempts)
    .where(eq(deliveryAttempts.eventId, eventId))
    .orderBy(deliveryAttempts.attemptNumber);
}