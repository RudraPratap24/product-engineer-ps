import {
  pgTable,
  serial,
  varchar,
  text,
  timestamp,
  jsonb,
  integer,
  unique,
  index
} from "drizzle-orm/pg-core";

export const incidents = pgTable(
  "incidents",
  {
    id: serial("id").primaryKey(),

    incidentId: varchar("incident_id", { length: 100 })
      .notNull()
      .unique(),

    title: varchar("title", { length: 255 }).notNull(),

    description: text("description"),

    severity: varchar("severity", { length: 20 })
      .notNull()
      .default("medium"),

    status: varchar("status", { length: 20 })
      .notNull()
      .default("open"),

    createdAt: timestamp("created_at", {
      withTimezone: true
    })
      .notNull()
      .defaultNow(),

    updatedAt: timestamp("updated_at", {
      withTimezone: true
    })
      .notNull()
      .defaultNow()
  }
);

export const events = pgTable(
  "events",
  {
    id: serial("id").primaryKey(),

    eventId: varchar("event_id", { length: 100 })
      .notNull()
      .unique(),

    incidentId: integer("incident_id")
      .references(() => incidents.id),

    type: varchar("type", { length: 100 }).notNull(),

    occurredAt: timestamp("occurred_at", {
      withTimezone: true
    }).notNull(),

    payload: jsonb("payload").notNull(),

    status: varchar("status", { length: 30 })
      .notNull()
      .default("PENDING"),

    nextAttemptAt: timestamp("next_attempt_at", {
      withTimezone: true
    }),

    deliveryStartedAt: timestamp("delivery_started_at", {
        withTimezone: true,
    }),

    createdAt: timestamp("created_at", {
      withTimezone: true
    })
      .notNull()
      .defaultNow(),

    updatedAt: timestamp("updated_at", {
      withTimezone: true
    })
      .notNull()
      .defaultNow()
  },
  (table) => [
    index("events_status_next_attempt_idx").on(
      table.status,
      table.nextAttemptAt
    )
  ]
);

export const deliveryAttempts = pgTable(
  "delivery_attempts",
  {
    id: serial("id").primaryKey(),

    eventId: integer("event_id")
      .notNull()
      .references(() => events.id),

    attemptNumber: integer("attempt_number").notNull(),

    status: varchar("status", { length: 30 })
      .notNull(),

    httpStatus: integer("http_status"),

    error: text("error"),

    startedAt: timestamp("started_at", {
      withTimezone: true
    })
      .notNull()
      .defaultNow(),

    completedAt: timestamp("completed_at", {
      withTimezone: true
    }),

    durationMs: integer("duration_ms")
  },
  (table) => [
    unique("delivery_attempt_event_number_unique").on(
      table.eventId,
      table.attemptNumber
    ),

    index("delivery_attempts_event_idx").on(
      table.eventId
    )
  ]
);