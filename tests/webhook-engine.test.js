import { spawn } from "node:child_process";
import { expect, test } from "vitest";

const ENGINE_PORT = 3100;
const RECEIVER_PORT = 4100;

const ENGINE_URL =
  `http://localhost:${ENGINE_PORT}`;

const RECEIVER_URL =
  `http://localhost:${RECEIVER_PORT}`;

let engineProcess;
let receiverProcess;

function startProcess(command, args, env = {}) {
  const child = spawn(command, args, {
    env: {
      ...process.env,
      ...env,
      FORCE_COLOR: "0",
    },
    stdio: ["ignore", "pipe", "pipe"],
    shell: false,
  });

  child.stdout.on("data", (data) => {
    process.stdout.write(
      `[TEST PROCESS] ${data}`
    );
  });

  child.stderr.on("data", (data) => {
    process.stderr.write(
      `[TEST PROCESS ERROR] ${data}`
    );
  });

  return child;
}

function sleep(ms) {
  return new Promise((resolve) =>
    setTimeout(resolve, ms)
  );
}

async function waitForServer(
  url,
  timeout = 15000
) {
  const start = Date.now();

  while (Date.now() - start < timeout) {
    try {
      const response = await fetch(url);

      if (response.ok) {
        return;
      }
    } catch {
      // Server is not ready yet.
    }

    await sleep(200);
  }

  throw new Error(
    `Server did not start: ${url}`
  );
}

async function setReceiverMode(mode) {
  const response = await fetch(
    `${RECEIVER_URL}/control/mode`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        mode,
      }),
    }
  );

  if (!response.ok) {
    throw new Error(
      `Failed to set receiver mode: ${mode}`
    );
  }
}

async function createEvent(eventId) {
  const response = await fetch(
    `${ENGINE_URL}/events`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        eventId,
        type: "test.event",
        occurredAt:
          new Date().toISOString(),
        payload: {
          message:
            "Automated webhook engine test",
        },
      }),
    }
  );

  if (![200, 202].includes(response.status)) {
    const body = await response.text();

    throw new Error(
      `Failed to create event. ` +
      `Status: ${response.status}, ` +
      `Body: ${body}`
    );
  }

  return response.json();
}

async function getEvent(eventId) {
  const response = await fetch(
    `${ENGINE_URL}/events/${eventId}`
  );

  if (!response.ok) {
    throw new Error(
      `Failed to get event ${eventId}`
    );
  }

  return response.json();
}

async function waitForStatus(
  eventId,
  expectedStatus,
  timeout = 15000
) {
  const start = Date.now();

  while (Date.now() - start < timeout) {
    const event =
      await getEvent(eventId);

    if (event.status === expectedStatus) {
      return event;
    }

    await sleep(50);
  }

  const event =
    await getEvent(eventId);

  throw new Error(
    `Timed out waiting for ${eventId} ` +
    `to become ${expectedStatus}. ` +
    `Current status: ${event.status}. ` +
    `Attempts: ${JSON.stringify(event.attempts)}`
  );
}

async function waitForAttemptCount(
  eventId,
  count,
  timeout = 15000
) {
  const start = Date.now();

  while (Date.now() - start < timeout) {
    const event =
      await getEvent(eventId);

    if (event.attempts.length >= count) {
      return event;
    }

    await sleep(50);
  }

  const event =
    await getEvent(eventId);

  throw new Error(
    `Timed out waiting for ${eventId} ` +
    `to reach ${count} attempts. ` +
    `Current status: ${event.status}. ` +
    `Attempts: ${JSON.stringify(event.attempts)}`
  );
}

test(
  "webhook retry engine end-to-end scenarios",
  async () => {
    // ============================================================
    // START MOCK RECEIVER
    // ============================================================

    receiverProcess = startProcess(
      "node",
      ["receiver/server.js"],
      {
        RECEIVER_PORT:
          String(RECEIVER_PORT),
      }
    );

    await waitForServer(
      `${RECEIVER_URL}/control/mode`
    );

    // ============================================================
    // START WEBHOOK ENGINE
    // ============================================================

    engineProcess = startProcess(
      "node",
      ["src/server.js"],
      {
        PORT: String(ENGINE_PORT),
        WEBHOOK_URL:
          `${RECEIVER_URL}/webhook`,
        RETRY_BASE_DELAY_MS: "50",
        REQUEST_TIMEOUT_MS: "200",
        DELIVERY_LEASE_TIMEOUT_MS: "1000",
        MAX_ATTEMPTS: "5",
      }
    );

    await waitForServer(
      `${ENGINE_URL}/health`
    );

    // ============================================================
    // TEST 1: Successful delivery
    // ============================================================

    console.log(
      "\nTEST 1: Successful delivery"
    );

    await setReceiverMode("SUCCESS");

    const successEventId =
      `test_success_${Date.now()}`;

    const created =
      await createEvent(
        successEventId
      );

    expect(created.eventId)
      .toBe(successEventId);

    expect(created.status)
      .toBe("PENDING");

    const successEvent =
      await waitForStatus(
        successEventId,
        "SUCCEEDED",
        10000
      );

    expect(successEvent.attempts)
      .toHaveLength(1);

    expect(
      successEvent.attempts[0].status
    ).toBe("SUCCEEDED");

    expect(
      successEvent.attempts[0].httpStatus
    ).toBe(200);

    console.log(
      "✓ Successful delivery"
    );

    // ============================================================
    // TEST 2: Temporary failure → retry → success
    // ============================================================

    console.log(
      "\nTEST 2: Temporary failure → retry → success"
    );

    await setReceiverMode("FAIL_503");

    const retryEventId =
      `test_retry_${Date.now()}`;

    await createEvent(
      retryEventId
    );

    // Let the first two attempts fail with 503.
    await waitForAttemptCount(
      retryEventId,
      2,
      10000
    );

    // Only after the failed attempts are recorded,
    // switch the receiver to success.
    await setReceiverMode("SUCCESS");

    const retryEvent =
      await waitForStatus(
        retryEventId,
        "SUCCEEDED",
        10000
      );

    expect(
      retryEvent.attempts.length
    ).toBeGreaterThanOrEqual(2);

    const failedAttempts =
      retryEvent.attempts.slice(0, -1);

    expect(
      failedAttempts.every(
        (attempt) =>
          attempt.status === "FAILED" &&
          attempt.httpStatus === 503
      )
    ).toBe(true);

    const finalAttempt =
      retryEvent.attempts[
        retryEvent.attempts.length - 1
      ];

    expect(finalAttempt.status)
      .toBe("SUCCEEDED");

    expect(finalAttempt.httpStatus)
      .toBe(200);

    console.log(
      `✓ Retry succeeded after ` +
      `${retryEvent.attempts.length} attempts`
    );

    // ============================================================
    // TEST 3: Retry exhaustion
    // ============================================================

    console.log(
      "\nTEST 3: Retry exhaustion"
    );

    await setReceiverMode("FAIL_503");

    const exhaustionEventId =
      `test_exhaustion_${Date.now()}`;

    await createEvent(
      exhaustionEventId
    );

    const finalEvent =
      await waitForStatus(
        exhaustionEventId,
        "FAILED",
        10000
      );

    expect(finalEvent.attempts)
      .toHaveLength(5);

    expect(
      finalEvent.attempts.every(
        (attempt) =>
          attempt.status === "FAILED" &&
          attempt.httpStatus === 503
      )
    ).toBe(true);

    expect(
      finalEvent.nextAttemptAt
    ).toBeNull();

    console.log(
      "✓ Retry exhaustion after 5 attempts"
    );

    // ============================================================
    // TEST 4: Duplicate ingestion / idempotency
    // ============================================================

    console.log(
      "\nTEST 4: Duplicate event / idempotency"
    );

    await setReceiverMode("SUCCESS");

    const duplicateEventId =
      `test_duplicate_${Date.now()}`;

    const first =
      await createEvent(
        duplicateEventId
      );

    const second =
      await createEvent(
        duplicateEventId
      );

    const third =
      await createEvent(
        duplicateEventId
      );

    expect(first.eventId)
      .toBe(duplicateEventId);

    expect(first.duplicate)
      .toBe(false);

    expect(second.duplicate)
      .toBe(true);

    expect(third.duplicate)
      .toBe(true);

    const duplicateEvent =
      await waitForStatus(
        duplicateEventId,
        "SUCCEEDED",
        10000
      );

    expect(duplicateEvent.attempts)
      .toHaveLength(1);

    expect(
      duplicateEvent.attempts[0].status
    ).toBe("SUCCEEDED");

    expect(
      duplicateEvent.attempts[0].httpStatus
    ).toBe(200);

    console.log(
      "✓ Duplicate ingestion resulted in a single delivery"
    );
  },
  60000
);

// ============================================================
// CLEANUP
// ============================================================

function cleanup() {
  engineProcess?.kill();
  receiverProcess?.kill();
}

process.on("exit", cleanup);

process.on("SIGINT", () => {
  cleanup();
  process.exit();
});

process.on("SIGTERM", () => {
  cleanup();
  process.exit();
});