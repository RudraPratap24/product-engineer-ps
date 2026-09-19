# Product Engineering Challenge Submission

## Candidate

- **Name:** Rudra Pratap Singh
- **Email:** `rudrapratap24apr@gmail.com`
- **GitHub:** https://github.com/RudraPratap24
- **Selected problem:** Problem 2 — Webhook Retry Engine
- **Demo video:** `https://www.loom.com/share/35a9721a132847ac986aec4053c977ac`

---

## Run the project

### Prerequisites

The project requires:

- Node.js 24+
- npm
- Docker Desktop

The application stack consists of:

- Node.js
- Express.js
- PostgreSQL 17
- Redis 7
- BullMQ
- Drizzle ORM
- Zod
- Vitest

PostgreSQL and Redis are provided through the included Docker Compose configuration.

### 1. Install dependencies

```bash
npm install
```

### 2. Start PostgreSQL and Redis

```bash
docker compose up -d
```

The provided `docker-compose.yml` starts:

- PostgreSQL 17 Alpine on port `5432`
- Redis 7 Alpine on port `6379`

Both services have Docker health checks configured.

PostgreSQL is configured locally with:

```text
Database: webhook_engine
User: postgres
Password: postgres
Host: localhost
Port: 5432
```

Redis is configured locally with:

```text
Host: localhost
Port: 6379
```

### 3. Configure environment variables

Create a `.env` file in the project root using `.env.example`.

Required variables:

```env
NODE_ENV=development

PORT=3000

DATABASE_URL=postgresql://postgres:postgres@localhost:5432/webhook_engine

REDIS_HOST=localhost
REDIS_PORT=6379

WEBHOOK_URL=http://localhost:4001/webhook

MAX_ATTEMPTS=5
RETRY_BASE_DELAY_MS=2000
DELIVERY_LEASE_TIMEOUT_MS=30000

REQUEST_TIMEOUT_MS=3000
```

No secret values should be committed to the repository.

### 4. Apply database migrations

After PostgreSQL is running:

```bash
npm run db:migrate
```

The project uses Drizzle migrations to create the required database schema.

The database contains persistent event and delivery-attempt state. In particular, the event ID is protected by a unique constraint to support idempotent ingestion.

### 5. Start the mock webhook receiver

In one terminal:

```bash
npm run receiver
```

The mock receiver runs on:

```text
http://localhost:4001
```

It provides a controllable webhook endpoint and supports the following modes:

```text
SUCCESS
FAIL_400
FAIL_500
FAIL_503
TIMEOUT
```

This allows the retry engine to be tested against deterministic success, permanent failure, temporary failure and timeout scenarios without relying on an external webhook provider.

### 6. Start the webhook engine

In another terminal:

```bash
npm start
```

The main API runs on:

```text
http://localhost:3000
```

For development with automatic Node.js restart:

```bash
npm run dev
```

### API endpoints

#### Health check

```http
GET /health
```

#### Create an event

```http
POST /events
Content-Type: application/json
```

Example:

```json
{
  "eventId": "order_123",
  "type": "order.created",
  "occurredAt": "2026-09-18T12:00:00.000Z",
  "payload": {
    "orderId": "123",
    "amount": 999
  }
}
```

#### Get event status

```http
GET /events/:eventId
```

The event status response contains the current state and the recorded delivery attempts.

---

### Successful delivery scenario

First configure the mock receiver to return HTTP 200:

```bash
curl -X POST http://localhost:4001/control/mode \
  -H "Content-Type: application/json" \
  -d '{"mode":"SUCCESS"}'
```

Create an event:

```bash
curl -X POST http://localhost:3000/events \
  -H "Content-Type: application/json" \
  -d '{
    "eventId": "demo_success_001",
    "type": "order.created",
    "occurredAt": "2026-09-18T12:00:00.000Z",
    "payload": {
      "orderId": "123",
      "amount": 999
    }
  }'
```

Then query the event:

```bash
curl http://localhost:3000/events/demo_success_001
```

The expected lifecycle is:

```text
PENDING
   ↓
DELIVERING
   ↓
SUCCEEDED
```

The event should have one delivery attempt with:

```text
status     = SUCCEEDED
httpStatus = 200
```

---

### Temporary failure → retry → success

Configure the receiver to return HTTP 503:

```bash
curl -X POST http://localhost:4001/control/mode \
  -H "Content-Type: application/json" \
  -d '{"mode":"FAIL_503"}'
```

Create an event:

```bash
curl -X POST http://localhost:3000/events \
  -H "Content-Type: application/json" \
  -d '{
    "eventId": "demo_retry_001",
    "type": "order.created",
    "occurredAt": "2026-09-18T12:00:00.000Z",
    "payload": {
      "orderId": "456"
    }
  }'
```

The first delivery attempt receives HTTP 503.

The worker records the failed attempt and schedules a retry.

The retry delay follows exponential backoff:

```text
delay = RETRY_BASE_DELAY_MS × 2^(attempt - 1)
```

For example, with the default base delay:

```text
Attempt 1 → 2 seconds
Attempt 2 → 4 seconds
Attempt 3 → 8 seconds
Attempt 4 → 16 seconds
...
```

Before a subsequent retry, switch the receiver back to success:

```bash
curl -X POST http://localhost:4001/control/mode \
  -H "Content-Type: application/json" \
  -d '{"mode":"SUCCESS"}'
```

Query the event again:

```bash
curl http://localhost:3000/events/demo_retry_001
```

The expected result is:

```text
Attempt 1 → HTTP 503 → FAILED
Attempt 2 → HTTP 200 → SUCCEEDED
```

The engine therefore recovers from a temporary webhook failure without losing the event.

---

### Retry exhaustion scenario

Configure the receiver to continuously return HTTP 503:

```bash
curl -X POST http://localhost:4001/control/mode \
  -H "Content-Type: application/json" \
  -d '{"mode":"FAIL_503"}'
```

Create another event and allow the engine to process it.

With:

```text
MAX_ATTEMPTS=5
```

the engine will make five delivery attempts.

The expected result is:

```text
Attempt 1 → 503 → FAILED
Attempt 2 → 503 → FAILED
Attempt 3 → 503 → FAILED
Attempt 4 → 503 → FAILED
Attempt 5 → 503 → FAILED

Final event state → FAILED
nextAttemptAt     → null
```

No additional retry is scheduled after the maximum number of attempts has been exhausted.

---

### Duplicate event / idempotency scenario

Set the receiver back to success:

```bash
curl -X POST http://localhost:4001/control/mode \
  -H "Content-Type: application/json" \
  -d '{"mode":"SUCCESS"}'
```

Submit the same event ID multiple times.

For example:

```text
Request 1 → duplicate: false
Request 2 → duplicate: true
Request 3 → duplicate: true
```

The first request creates the event. Subsequent requests identify the existing event rather than creating another event or another delivery.

The final event should contain exactly one delivery attempt.

This demonstrates that duplicate ingestion does not result in duplicate webhook deliveries.

---

## Run the tests

Run the automated test suite with:

```bash
npm test
```

The `package.json` test script is:

```text
vitest run --sequence.concurrent=false
```

The end-to-end test automatically starts the webhook engine and mock receiver and verifies the complete delivery flow.

The test covers four scenarios:

### Test 1 — Successful delivery

The mock receiver returns HTTP 200.

The test verifies:

- The event is created.
- The returned event ID is correct.
- The initial state is `PENDING`.
- The event eventually reaches `SUCCEEDED`.
- Exactly one delivery attempt is recorded.
- The attempt is `SUCCEEDED`.
- The attempt has HTTP status `200`.

### Test 2 — Temporary failure → retry → success

The receiver initially returns HTTP 503.

The test waits until the retry attempt has been created and then changes the receiver to `SUCCESS`.

It verifies:

- The first attempt failed with HTTP 503.
- A retry was scheduled.
- At least two attempts exist.
- Earlier attempts are failed 503 attempts.
- The final attempt succeeds.
- The final attempt has HTTP status 200.
- The event eventually reaches `SUCCEEDED`.

The expected flow is:

```text
Attempt 1 → 503 → FAILED
Attempt 2 → 200 → SUCCEEDED
```

### Test 3 — Retry exhaustion

The receiver continuously returns HTTP 503.

The test verifies:

- Exactly five attempts are recorded.
- Every attempt is `FAILED`.
- Every attempt has HTTP status `503`.
- The event reaches `FAILED`.
- `nextAttemptAt` is `null`.

This verifies the maximum-attempt boundary rather than only testing that a retry happens.

### Test 4 — Duplicate event / idempotency

The same event ID is submitted three times.

The test verifies:

```text
First request  → duplicate: false
Second request → duplicate: true
Third request  → duplicate: true
```

It then waits for the event to succeed and verifies:

```text
attempts.length === 1
attempt.status === SUCCEEDED
attempt.httpStatus === 200
```

The important part of this test is that duplicate ingestion is checked separately from successful delivery. A duplicate request must not create a second delivery attempt.

### Why the scenarios run sequentially

The four scenarios are intentionally executed sequentially inside a single end-to-end test.

The mock receiver has shared mutable state because its response mode changes between scenarios:

```text
SUCCESS
   ↓
FAIL_503
   ↓
SUCCESS
   ↓
FAIL_503
   ↓
SUCCESS
```

Running the scenarios concurrently could cause one test to change the receiver mode while another test is still waiting for a response.

The test therefore keeps the scenarios sequential while still exercising the real API, database, queue, worker and webhook receiver.

---

## Architecture and data flow

The core architecture is:

```text
                              ┌──────────────────┐
                              │      Client      │
                              └────────┬─────────┘
                                       │
                                  POST /events
                                       │
                                       ▼
                              ┌──────────────────┐
                              │   Express API    │
                              │                  │
                              │ Validation       │
                              │ Event ingestion  │
                              └────────┬─────────┘
                                       │
                                       ▼
                              ┌──────────────────┐
                              │    PostgreSQL    │
                              │                  │
                              │ Source of truth  │
                              │ Event state      │
                              │ Attempts         │
                              └────────┬─────────┘
                                       │
                                  BullMQ job
                                       │
                                       ▼
                              ┌──────────────────┐
                              │  Redis / BullMQ  │
                              │                  │
                              │ Scheduling       │
                              │ Delayed retries  │
                              │ Background jobs  │
                              └────────┬─────────┘
                                       │
                                       ▼
                              ┌──────────────────┐
                              │ Delivery Worker  │
                              │                  │
                              │ Claim event      │
                              │ Create attempt   │
                              │ HTTP delivery    │
                              │ Record result    │
                              │ Schedule retry   │
                              └────────┬─────────┘
                                       │
                                    HTTP POST
                                       │
                                       ▼
                              ┌──────────────────┐
                              │ Webhook Receiver │
                              │ / External API   │
                              └──────────────────┘
```

The main design principle is that PostgreSQL represents the durable state of the webhook system, while Redis/BullMQ represents work that needs to be executed.

### Project structure

The main application is organized into separate layers:

```text
src/
├── api/
│   ├── event.controller.js
│   ├── event.routes.js
│   └── schemas.js
│
├── db/
│   └── schema.js
│
├── domain/
│   └── retry-policy.js
│
├── infrastructure/
│   ├── database.js
│   ├── http-client.js
│   └── redis.js
│
├── queue/
│   ├── delivery.queue.js
│   ├── delivery.worker.js
│   └── recovery.worker.js
│
├── repositories/
│   ├── attempt.repository.js
│   └── event.repository.js
│
├── services/
│   ├── delivery.service.js
│   ├── event-query.service.js
│   ├── event.service.js
│   └── recovery.service.js
│
└── utils/
    └── logger.js
```

The intention is to keep HTTP concerns, persistence, domain retry policy, queue processing and application services separate.

---

### Event ingestion

The client sends an event through:

```http
POST /events
```

The API validates the request before passing it to the event service.

The event service persists the event in PostgreSQL.

The database generates the durable event state.

After persistence, the delivery job is scheduled through BullMQ.

The API therefore does not wait for the external webhook request to finish before responding to the client.

The main request path is:

```text
Client
  ↓
POST /events
  ↓
Validation
  ↓
Create event in PostgreSQL
  ↓
Schedule delivery job
  ↓
Return event information
```

The actual webhook delivery happens asynchronously.

---

### PostgreSQL as source of truth

The database stores the state needed to reconstruct what happened to an event.

The event record contains fields including:

- Event ID
- Event type
- Occurrence timestamp
- Payload
- Current status
- Next attempt timestamp
- Delivery start timestamp

Delivery attempts are stored separately and contain information such as:

- Event ID
- Attempt number
- Attempt status
- HTTP status
- Error information
- Start timestamp
- Completion timestamp

This means an event's delivery history can be inspected independently of the current queue state.

---

### Database-level idempotency

The event ID has a unique constraint.

This is important because an application-level check alone has a race condition:

```text
Request A → check event → not found
Request B → check event → not found
Request A → insert
Request B → insert
```

The database-level unique constraint prevents both inserts from succeeding.

The event service also handles PostgreSQL's unique-constraint violation and retrieves the already-existing event.

Therefore, duplicate event ingestion is safe even when duplicate requests arrive concurrently.

---

### Queue scheduling

BullMQ is used for asynchronous delivery.

The delivery queue uses deterministic job IDs based on the event and attempt number:

```text
eventId:attempt:n
```

This means the same delivery attempt maps to the same logical queue job identity.

The queue is responsible for scheduling work, including delayed retry attempts.

It is not treated as the permanent record of whether an event exists or whether it was successfully delivered.

---

### Delivery worker

The delivery worker performs the actual webhook request.

Its flow is approximately:

```text
Receive BullMQ job
       ↓
Claim event
       ↓
Create delivery-attempt record
       ↓
Send HTTP request
       ↓
Receive response / timeout / network error
       ↓
Record attempt result
       ↓
Update event state
       ↓
Schedule retry if necessary
```

The event is claimed using database state so multiple workers do not simultaneously process the same event.

---

### Retry policy

The retry policy classifies failures into retryable and terminal failures.

Retryable HTTP statuses are:

```text
408 Request Timeout
425 Too Early
429 Too Many Requests
500 Internal Server Error
502 Bad Gateway
503 Service Unavailable
504 Gateway Timeout
```

Network errors and request timeouts are also considered retryable.

Other HTTP failures are treated as terminal.

For retryable failures, the system calculates an exponential delay:

```text
delay = RETRY_BASE_DELAY_MS × 2^(attempt - 1)
```

For example:

```text
Attempt 1 → base delay
Attempt 2 → 2 × base delay
Attempt 3 → 4 × base delay
Attempt 4 → 8 × base delay
```

The maximum number of attempts is controlled by `MAX_ATTEMPTS`.

Once the maximum is reached, the event is marked `FAILED` and no further retry time is stored.

---

### Event state machine

The main event states are:

```text
                ┌───────────────┐
                │    PENDING    │
                └───────┬───────┘
                        │
                        ▼
                ┌───────────────┐
                │  DELIVERING   │
                └───────┬───────┘
                        │
             ┌──────────┼──────────┐
             │          │          │
             │          │          │
             ▼          ▼          ▼
        SUCCEEDED    RETRYING    FAILED
                         │
                         │ retry time reached
                         ▼
                    DELIVERING
```

A successful 2xx response leads to `SUCCEEDED`.

A retryable failure before the maximum attempt count leads to `RETRYING`.

A terminal failure or retry exhaustion leads to `FAILED`.

---

### Delivery lease and worker recovery

A worker can crash after an event has been marked `DELIVERING`.

Without recovery, that event could remain stuck indefinitely.

The implementation therefore records when delivery started.

The configured:

```text
DELIVERY_LEASE_TIMEOUT_MS
```

defines how long a delivery can remain in progress before it is considered stale.

The recovery process identifies stale deliveries and makes them eligible for processing again.

This handles failures such as:

```text
Worker starts delivery
       ↓
External request is in progress
       ↓
Worker process crashes
       ↓
No completion update is written
       ↓
Lease becomes stale
       ↓
Recovery identifies stale event
       ↓
Event becomes eligible for another delivery
```

---

### Database commit → queue enqueue failure

Another important failure case is:

```text
PostgreSQL transaction commits
       ↓
Application crashes
       ↓
BullMQ job is never created
```

If the queue were the only place where pending work existed, the event could be lost from the delivery pipeline.

The implementation instead keeps the event state in PostgreSQL and has a periodic recovery/dispatch process inspect the database for events that are ready for delivery.

This provides a recovery path for events that were persisted but did not successfully make it into the queue.

A transactional outbox would be a stronger production implementation of this pattern, but the database-backed recovery approach keeps the prototype smaller while addressing the failure window.

---

### At-least-once delivery semantics

The system intentionally provides at-least-once delivery.

Exactly-once delivery cannot be guaranteed across an external HTTP boundary.

For example:

```text
Worker
  │
  │ HTTP POST
  ▼
External receiver
  │
  │ processes request
  │
  X worker crashes before success is persisted
```

The receiver may have already processed the webhook even though the worker never recorded the successful result.

The safe behaviour is to allow the system to retry.

This means a webhook consumer may receive the same event more than once.

Consumers should therefore use `eventId` as an idempotency key when applying side effects.

---

## Technology choices

### Node.js

Node.js was selected because this service is primarily I/O-bound.

The application performs:

- HTTP API operations
- Database operations
- Redis operations
- External HTTP requests
- Background job processing

The asynchronous Node.js model fits these operations naturally.

---

### Express.js

Express was selected for the API because the HTTP layer is relatively small and does not require a large application framework.

It provides the required routing and middleware functionality while keeping the implementation straightforward.

---

### PostgreSQL

PostgreSQL was selected as the source of truth because the system needs durable state, uniqueness guarantees and concurrency control.

The important database capabilities used by the solution are:

- Unique constraints
- Transactions
- Row locking
- Persistent event state
- Persistent delivery attempts

A database is also useful for recovery because the system can query what work exists independently of the queue.

---

### Redis + BullMQ

BullMQ provides the background processing and delayed-job functionality required by the retry engine.

Redis is used as the queue backend.

The separation is deliberate:

```text
PostgreSQL → What happened?
BullMQ     → What work should happen?
```

This avoids making Redis job state the authoritative representation of an event.

---

### Drizzle ORM

Drizzle was chosen as a lightweight ORM/database layer.

The project has a relatively small relational model, so I wanted to keep the schema and queries close to the actual database rather than introducing a heavy abstraction.

---

### Zod

Zod is used at the API boundary to validate incoming event payloads.

This prevents malformed requests from entering the event persistence and delivery pipeline.

---

### Native fetch + AbortController

The webhook delivery layer uses Node.js's native `fetch`.

`AbortController` is used to enforce the configured request timeout.

This keeps the HTTP client implementation small and avoids an additional HTTP client dependency.

---

### Vitest

Vitest is used for automated verification.

The most important behaviour in this problem is distributed across several components:

```text
API
 ↓
PostgreSQL
 ↓
BullMQ / Redis
 ↓
Worker
 ↓
External webhook
```

For that reason, the main test is an end-to-end test rather than only a collection of isolated unit tests.

---

### Docker Compose

Docker Compose was used to make the PostgreSQL and Redis setup reproducible.

The project provides:

```text
PostgreSQL 17 Alpine
Redis 7 Alpine
```

with health checks and persistent Docker volumes.

---

### Alternatives considered

#### Transactional outbox

A transactional outbox was considered because it gives a stronger guarantee between database state and queue publishing.

For this take-home, I used periodic database-backed recovery instead to avoid adding another persistence layer/table and another publisher process.

For production scale, I would revisit the outbox approach.

#### PostgreSQL-only queue

A PostgreSQL polling implementation was also possible.

However, BullMQ gives better support for delayed jobs and worker-based asynchronous processing while PostgreSQL remains the durable source of truth.

#### Exactly-once delivery

Exactly-once delivery was not pursued because the application cannot atomically coordinate a database transaction with an external HTTP receiver.

At-least-once delivery with consumer-side idempotency is the intended model.

---

## Important decisions

### 1. PostgreSQL is the source of truth

The system does not treat Redis as the authoritative record of webhook state.

PostgreSQL stores:

```text
Event existence
Event state
Retry timing
Delivery attempts
HTTP responses
Errors
Delivery timestamps
```

BullMQ is only responsible for getting work to a worker.

This makes the system recoverable when queue or worker failures occur.

---

### 2. Database-enforced idempotency

I chose a database unique constraint on `eventId` rather than relying only on an application-level lookup.

An application-only check has a race condition:

```text
Thread A → SELECT → no event
Thread B → SELECT → no event
Thread A → INSERT
Thread B → INSERT
```

The database constraint makes the uniqueness guarantee atomic.

The application handles the unique constraint case and returns the existing event.

---

### 3. At-least-once rather than exactly-once

A webhook delivery crosses an external system boundary.

There is always a possible uncertainty window between:

```text
External system processes request
```

and:

```text
Local worker records successful delivery
```

Therefore, retrying after uncertainty can cause duplicate delivery.

The system chooses at-least-once semantics and expects consumers to deduplicate using the event ID.

---

### 4. Delivery lease

A delivery lease protects against worker crashes.

An event in `DELIVERING` is not assumed to be permanently owned by a worker.

Once the lease becomes stale, recovery can make the event eligible again.

This prevents worker termination from permanently blocking an event.

---

### 5. Keep the implementation focused

The implementation deliberately avoids introducing infrastructure that is not required to demonstrate the core behaviour.

I did not add:

- Kafka
- Kubernetes
- Microservices for each component
- A separate event bus
- A complex admin dashboard
- A complete metrics platform
- Multiple databases

The core reliability properties can be demonstrated with PostgreSQL, Redis/BullMQ and worker processes.

---

## Assumptions and limitations

### Assumptions

- `eventId` uniquely identifies a logical webhook event.
- Downstream consumers can use `eventId` for deduplication.
- PostgreSQL is available as durable storage.
- Redis is available for queue processing.
- The configured webhook URL is reachable by the worker.
- A single webhook destination is sufficient for this prototype.
- Retry policy is globally configured.
- The receiver's response determines whether a delivery succeeds or fails.
- The prototype is intended for local execution and evaluation.

### Limitations

The current implementation does not include:

- Multiple webhook destinations
- Per-destination retry policies
- Per-destination rate limiting
- Per-destination concurrency controls
- Webhook authentication/signature verification
- Full production metrics
- Distributed tracing
- Administrative replay tooling
- Dedicated dead-letter queue management UI
- High-availability PostgreSQL configuration
- High-availability Redis configuration
- Multi-region deployment
- Tenant-level isolation

These are deliberately outside the scope of the prototype.

The core problem being solved is reliable event ingestion, retry scheduling, delivery tracking, idempotency and recovery.

---

## Production and scale

If this prototype needed to operate in production at significantly greater scale, I would prioritize reliability and operational visibility before adding more application features.

### 1. Transactional outbox

The first architectural improvement would be a transactional outbox.

The current design has:

```text
Persist event
      ↓
Dispatch BullMQ job
```

The production design could instead use:

```text
┌─────────────────────────────┐
│ PostgreSQL transaction      │
│                             │
│ Event + Outbox record       │
└──────────────┬──────────────┘
               │
               ▼
       Outbox publisher
               │
               ▼
           BullMQ
               │
               ▼
            Worker
```

The event and its required asynchronous work would be persisted atomically.

The publisher could retry queue publication until it succeeds.

This makes the database-to-queue handoff more explicit and robust.

---

### 2. Horizontal worker scaling

The worker can be scaled horizontally by running multiple worker processes.

BullMQ can distribute jobs among workers, while database-level event claiming prevents multiple workers from processing the same event concurrently.

Worker concurrency would need to be tuned according to:

- Queue volume
- External destination capacity
- Database capacity
- Network capacity

---

### 3. Per-destination rate limiting

A production system would likely deliver to many webhook destinations.

A single global concurrency setting would not be enough.

I would introduce:

```text
Per-destination rate limits
Per-destination concurrency
Per-destination timeouts
Per-destination retry policy
```

This prevents a slow or failing destination from consuming all available worker capacity.

---

### 4. Observability

I would introduce structured metrics around:

```text
Delivery success rate
Delivery failure rate
Retry rate
Average delivery latency
Queue depth
Worker processing time
HTTP response codes
Timeout count
Network error count
Stale delivery recovery count
```

Distributed tracing would allow an individual event to be followed through:

```text
API ingestion
    ↓
Database persistence
    ↓
Queue scheduling
    ↓
Worker execution
    ↓
HTTP delivery
    ↓
Completion/retry
```

---

### 5. Dead-letter and replay

After an event has exhausted its retry policy, a production system could move it into a dead-letter workflow.

Operators could inspect:

- Event ID
- Destination
- Attempt count
- Last HTTP status
- Last error
- Last attempt time
- Payload metadata

After fixing the destination issue, an operator could replay the event.

Replay operations would need their own idempotency controls.

---

### 6. High availability

A production deployment would likely use:

- Multiple API instances
- Multiple worker instances
- Load balancing
- Highly available PostgreSQL
- Highly available Redis
- Health checks
- Graceful worker shutdown
- Centralized logs
- Metrics and alerting

The event state model and idempotency guarantees would remain central to the design.

---

## AI usage

I used **ChatGPT** as a development assistant during the implementation.

AI assistance was used for:

- Discussing the architecture of the webhook retry engine.
- Thinking through failure scenarios.
- Reviewing retry and idempotency approaches.
- Debugging implementation issues during development.
- Reviewing the end-to-end test scenarios.
- Discussing edge cases involving worker failures and recovery.
- Reviewing technical documentation and submission structure.

AI was used as an engineering aid rather than as a replacement for implementation and verification.

The implementation was run in my local development environment.

The final system behaviour was verified through the end-to-end test suite, including:

```text
Successful delivery
Temporary failure → retry → success
Retry exhaustion
Duplicate event / idempotency
```

---

## Credibility note

### DaakitGo — Backend Engineering Internship

#### The problem it solved

DaakitGo is a quick-commerce/logistics backend platform involving workflows around merchants, orders, riders, warehouses, pricing and shipment operations.

The backend contained multiple modules and integrations rather than being a simple CRUD application.

It involved persistent database state, asynchronous processing and communication with external services.

#### My personal contribution

I worked as a backend intern using:

```text
Node.js
Express.js
MySQL
Redis
BullMQ
JWT
Multer
Puppeteer
bwip-js
```

My work included backend API development, database operations, authentication, asynchronous processing and external integrations.

Some of the areas I worked on included:

- Merchant APIs
- Rider APIs
- Order-related backend flows
- Rider location processing
- Pricing APIs
- AWB generation
- Label generation
- Barcode generation
- Webhook integrations
- Redis-backed processing
- BullMQ background jobs
- JWT cookie authentication
- External service integrations

I also worked with integrations including:

```text
MSG91
EASEBUZZ
Holisol webhook
Exotel webhook
```

#### Scale / operational complexity

The backend consisted of multiple modules communicating with a shared MySQL database and Redis-backed background processing.

Some operations were asynchronous and depended on external systems.

For example, rider-location updates were processed through a BullMQ queue before updating the database.

Other workflows involved external API calls and webhook callbacks, meaning that failures could happen outside the application's direct control.

This gave me practical exposure to the type of reliability problems that are also relevant to webhook delivery systems.

#### One difficult engineering decision

A recurring engineering challenge was maintaining consistent application state when asynchronous jobs and external services were involved.

For example, the rider-location workflow used background processing so that location updates could be processed asynchronously rather than blocking the main request path.

I also worked through issues involving:

- Database state
- Redis jobs
- External API responses
- Webhook callbacks
- Background processing
- Error handling

This experience influenced the architecture of this take-home solution.

The webhook engine similarly separates durable database state from asynchronous queue processing and explicitly models retries and failures instead of hiding them inside a background job.

#### Evidence

The DaakitGo implementation is private company code and cannot be publicly shared.

---

### Rohde & Schwarz — Industrial Training

I also worked on a regression-testing automation utility during my industrial training at Rohde & Schwarz.

#### The problem it solved

The objective was to automate overnight regression testing through a GUI so that regression workflows could run with less manual intervention.

The utility integrated RF testing knowledge and company-specific test cases.

#### My personal contribution

I worked with:

```text
Python
FastAPI
React.js
PowerShell
```

FastAPI was used for the backend.

React.js was used for the frontend interface.

PowerShell scripting was used as part of the automation workflow.

The utility connected the GUI with the backend automation and company-specific regression test workflows.

#### Scale / operational complexity

The application was designed around an internal regression-testing workflow where the frontend, backend and test execution process had to work together.

The main engineering challenge was coordinating the GUI, backend API and automation workflow while keeping the process usable for the intended overnight regression use case.

#### One difficult engineering decision

The system needed to provide a user-facing interface while also triggering and coordinating backend automation.

This required keeping the frontend interaction separate from the actual test execution and automation logic.

The FastAPI backend acted as the interface between the React frontend and the underlying automation workflow.

#### Evidence

The source code and internal testing infrastructure are private company assets and cannot be publicly shared.
