# Webhook Retry Engine

A durable webhook delivery service built with Node.js, PostgreSQL, Redis, and BullMQ.

The engine accepts webhook events, persists them before scheduling delivery, delivers them asynchronously, retries transient failures with exponential backoff, prevents duplicate ingestion, and exposes delivery state and attempt history through an API.

## Architecture

```text
                    POST /events
                         │
                         ▼
                ┌─────────────────┐
                │   Express API   │
                └────────┬────────┘
                         │
                         ▼
                ┌─────────────────┐
                │   PostgreSQL    │
                │ Source of Truth │
                └────────┬────────┘
                         │
                         ▼
                ┌─────────────────┐
                │ BullMQ + Redis  │
                │    Scheduler    │
                └────────┬────────┘
                         │
                         ▼
                ┌─────────────────┐
                │ Webhook Worker  │
                └────────┬────────┘
                         │
                         ▼
                  External Webhook
                     Receiver
```

PostgreSQL is the source of truth for event and delivery state. Redis/BullMQ is used for asynchronous scheduling and delayed jobs.

## Core Design

The implementation follows these principles:

- Persist the event before scheduling delivery.
- Use a unique `eventId` for ingestion idempotency.
- Store every delivery attempt in PostgreSQL.
- Use BullMQ for asynchronous delivery scheduling.
- Retry transient failures using exponential backoff.
- Stop retrying after a bounded number of attempts.
- Recover deliveries that become stuck in `DELIVERING`.
- Periodically redispatch persisted events that are ready but are not currently queued.
- Expose current event state and attempt history through the API.

The queue is treated as a delivery mechanism, not as the durable source of truth.

## Delivery Semantics

The engine provides **at-least-once delivery semantics**.

Exactly-once delivery cannot be guaranteed across an external HTTP boundary. For example, a worker may successfully send an HTTP request and then crash before recording the successful result in PostgreSQL. Retrying in that situation can result in another request.

For this reason, consumers should use the stable `eventId` as their own idempotency key when exactly-once business processing is required.

## Retry Policy

The default configuration allows up to five delivery attempts.

The following HTTP responses are treated as retryable:

- `408 Request Timeout`
- `425 Too Early`
- `429 Too Many Requests`
- `500 Internal Server Error`
- `502 Bad Gateway`
- `503 Service Unavailable`
- `504 Gateway Timeout`

Network errors and request timeouts are also retryable.

The retry delay follows exponential backoff:

```text
delay = RETRY_BASE_DELAY_MS × 2^(attempt - 1)
```

After the configured maximum number of attempts, the event transitions to `FAILED` and no further retry is scheduled.

Successful `2xx` responses complete the delivery.

Other non-retryable HTTP responses are treated as terminal failures.

## Idempotency

`eventId` is the idempotency key for event ingestion.

The database enforces uniqueness on the event ID, making concurrent duplicate requests safe at the persistence layer.

For example:

```text
POST /events eventId=order_123
        │
        └── creates event

POST /events eventId=order_123
        │
        └── duplicate → existing event returned

POST /events eventId=order_123
        │
        └── duplicate → existing event returned
```

Only the original event creates delivery work.

The end-to-end test verifies that repeated ingestion of the same event results in a single delivery attempt.

## Failure Recovery

### Database Commit → Queue Enqueue

The event is persisted first. If the process crashes before the BullMQ job is created, the event still exists in PostgreSQL.

A periodic recovery/dispatch process scans for persisted events that are ready for delivery and ensures they are scheduled.

### Worker Crash During Delivery

A delivery can remain in `DELIVERING` if the worker disappears while an HTTP request is in progress.

Delivery attempts therefore record when delivery started. Stale deliveries are detected after the configured lease timeout and recovered so they can be retried.

## API

### Create an Event

```http
POST /events
Content-Type: application/json
```

Example:

```json
{
  "eventId": "evt_123",
  "type": "order.created",
  "occurredAt": "2026-09-19T10:00:00.000Z",
  "payload": {
    "orderId": "order_123"
  }
}
```

A first submission creates the event.

A repeated `eventId` is treated as a duplicate and does not create another delivery.

### Get Event Status

```http
GET /events/:eventId
```

Returns the current event state together with its delivery attempts.

Example:

```json
{
  "eventId": "evt_123",
  "status": "SUCCEEDED",
  "attempts": [
    {
      "attemptNumber": 1,
      "status": "SUCCEEDED",
      "httpStatus": 200
    }
  ]
}
```

### Health Check

```http
GET /health
```

## Local Development

### Requirements

- Node.js 24+
- Docker
- Docker Compose
- npm

### Install

```bash
npm install
```

### Configure Environment

Copy the example environment file:

```bash
cp .env.example .env
```

On Windows PowerShell:

```powershell
Copy-Item .env.example .env
```

### Start Infrastructure

```bash
docker compose up -d
```

### Start the Engine

```bash
npm start
```

The API runs on:

```text
http://localhost:3000
```

## Mock Webhook Receiver

The repository includes a mock webhook receiver for local development and end-to-end testing.

It can simulate:

- successful delivery
- HTTP 400
- HTTP 500
- HTTP 503
- request timeout

This makes it possible to test retry and failure behavior without relying on an external service.

## Testing

The end-to-end test exercises the complete delivery path through the real HTTP API, database, queue, worker, and mock receiver.

It covers four scenarios:

1. Successful delivery
2. Temporary `503` failure followed by retry and success
3. Retry exhaustion after five attempts
4. Duplicate event ingestion / idempotency

Run:

```bash
npm test
```

The test intentionally runs the four scenarios inside one sequential end-to-end test because the mock receiver has shared mutable state. Keeping the scenarios in one execution makes the receiver mode transitions deterministic.

Expected result:

```text
Test Files  1 passed
Tests       1 passed
```

The single passing test contains all four end-to-end scenarios.

## Configuration

| Variable | Purpose | Default |
|---|---|---:|
| `PORT` | API port | `3000` |
| `DATABASE_URL` | PostgreSQL connection | Local PostgreSQL |
| `REDIS_HOST` | Redis hostname | `localhost` |
| `REDIS_PORT` | Redis port | `6379` |
| `WEBHOOK_URL` | Destination webhook | Local receiver |
| `MAX_ATTEMPTS` | Maximum delivery attempts | `5` |
| `RETRY_BASE_DELAY_MS` | Base retry delay | `2000` |
| `DELIVERY_LEASE_TIMEOUT_MS` | Stale delivery timeout | `30000` |
| `REQUEST_TIMEOUT_MS` | Outbound HTTP timeout | `3000` |

## Project Structure

```text
.
├── receiver/
│   └── server.js
├── src/
│   ├── db/
│   ├── queue/
│   ├── services/
│   └── server.js
├── tests/
│   └── webhook-engine.test.js
├── drizzle/
├── docker-compose.yml
├── drizzle.config.js
├── package.json
├── package-lock.json
└── .env.example
```

## Technology Choices

### Node.js + Express

Used for the HTTP API and service runtime.

### PostgreSQL

Used as the durable source of truth for events, delivery state, attempt history, and retry scheduling state.

### Drizzle ORM

Used for database schema and application-level database access.

### Redis + BullMQ

Used for asynchronous delivery scheduling and background workers.

BullMQ is deliberately not treated as the source of truth for event state.

### Zod

Used for request and configuration validation.

### Vitest

Used for end-to-end verification of the webhook delivery flow.

## Trade-offs

### PostgreSQL + Redis

PostgreSQL provides durable state and transactional uniqueness for idempotency. Redis/BullMQ provides efficient asynchronous scheduling and delayed jobs.

Using PostgreSQL as the source of truth also makes event state and delivery history independently inspectable from the queue.

### Recovery Without an Outbox Table

The implementation uses persisted event state together with a periodic dispatcher/recovery mechanism instead of introducing a separate outbox table.

This keeps the data model smaller while still addressing the failure window between a successful database commit and queue scheduling.

### At-Least-Once Delivery

The service deliberately uses at-least-once semantics rather than claiming exactly-once external delivery.

Exactly-once behavior across an external HTTP boundary requires cooperation from the receiving system. The stable event ID allows consumers to implement idempotent processing on their side.

## Failure Scenarios

| Failure | Behavior |
|---|---|
| `2xx` response | Delivery succeeds |
| `408/425/429` | Retry |
| `500/502/503/504` | Retry |
| Network error | Retry |
| Request timeout | Retry |
| Retry limit reached | Terminal `FAILED` |
| Duplicate event ID | No duplicate delivery |
| Worker crash during delivery | Stale delivery can be recovered |
| Database commit before queue enqueue | Recovery dispatcher can redispatch |

## Scope

This implementation focuses on the requested webhook retry engine and its reliability characteristics.

The solution intentionally avoids unrelated production features such as authentication, multi-tenant routing, distributed rate limiting, webhook signing, and a dedicated dead-letter queue UI.
