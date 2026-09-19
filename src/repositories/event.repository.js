import {
  eq,
  and,
  lte,
  or,
  isNull,
  max,
  inArray,
} from "drizzle-orm";

import { db } from "../infrastructure/database.js";
import { events, deliveryAttempts } from "../db/schema.js";

export async function findEventByEventId(eventId) {
  const result = await db
    .select()
    .from(events)
    .where(eq(events.eventId, eventId))
    .limit(1);

  return result[0] ?? null;
}

export async function createEvent(eventData) {
  const result = await db
    .insert(events)
    .values(eventData)
    .returning();

  return result[0];
}

export async function updateEvent(eventId, updates) {
  const result = await db
    .update(events)
    .set({
      ...updates,
      updatedAt: new Date(),
    })
    .where(eq(events.eventId, eventId))
    .returning();

  return result[0] ?? null;
}

export async function claimEventForDelivery(
  eventId,
  expectedAttemptNumber
) {
  const now = new Date();
  const maxAttempts = Number(
    process.env.MAX_ATTEMPTS || 5
  );

  return db.transaction(async (tx) => {
    const eventResult = await tx
      .select()
      .from(events)
      .where(eq(events.eventId, eventId))
      .for("update");

    const event = eventResult[0];

    if (!event) {
      return null;
    }

    const isEligible =
      ["PENDING", "RETRYING"].includes(event.status) &&
      (!event.nextAttemptAt ||
        event.nextAttemptAt <= now);

    if (!isEligible) {
      return null;
    }

    const attemptResult = await tx
      .select({
        latestAttemptNumber: max(
          deliveryAttempts.attemptNumber
        ),
      })
      .from(deliveryAttempts)
      .where(
        eq(deliveryAttempts.eventId, event.id)
      );

    const latestAttemptNumber = Number(
      attemptResult[0]?.latestAttemptNumber ?? 0
    );

    const nextAttemptNumber =
      latestAttemptNumber + 1;

    if (nextAttemptNumber > maxAttempts) {
      await tx
        .update(events)
        .set({
          status: "FAILED",
          nextAttemptAt: null,
          deliveryStartedAt: null,
          updatedAt: now,
        })
        .where(eq(events.id, event.id));

      return null;
    }

    if (
      nextAttemptNumber !==
      expectedAttemptNumber
    ) {
      return null;
    }

    const result = await tx
      .update(events)
      .set({
        status: "DELIVERING",
        deliveryStartedAt: now,
        updatedAt: now,
      })
      .where(eq(events.id, event.id))
      .returning();

    return result[0] ?? null;
  });
}

export async function findStaleDeliveringEvents(
  leaseTimeoutMs
) {
  const cutoff = new Date(
    Date.now() - leaseTimeoutMs
  );

  return db
    .select()
    .from(events)
    .where(
      and(
        eq(events.status, "DELIVERING"),
        lte(
          events.deliveryStartedAt,
          cutoff
        )
      )
    );
}

export async function recoverStaleEvent(
  eventId,
  cutoff
) {
  const result = await db
    .update(events)
    .set({
      status: "RETRYING",
      nextAttemptAt: new Date(),
      deliveryStartedAt: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(events.eventId, eventId),
        eq(events.status, "DELIVERING"),
        lte(
          events.deliveryStartedAt,
          cutoff
        )
      )
    )
    .returning();

  return result[0] ?? null;
}

export async function findEventsReadyForDispatch() {
  const now = new Date();

  return db
    .select()
    .from(events)
    .where(
      and(
        inArray(events.status, [
          "PENDING",
          "RETRYING",
        ]),
        or(
          isNull(events.nextAttemptAt),
          lte(events.nextAttemptAt, now)
        )
      )
    );
}
