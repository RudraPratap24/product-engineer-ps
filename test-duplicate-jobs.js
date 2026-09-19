import { deliveryQueue } from "./src/queue/delivery.queue.js";

const eventId = "evt_attempt_guard_001";
const attemptNumber = 2;

await Promise.all([
  deliveryQueue.add(
    "deliver-webhook",
    { eventId, attemptNumber },
    { jobId: `${eventId}:duplicate-test:1` }
  ),

  deliveryQueue.add(
    "deliver-webhook",
    { eventId, attemptNumber },
    { jobId: `${eventId}:duplicate-test:2` }
  ),

  deliveryQueue.add(
    "deliver-webhook",
    { eventId, attemptNumber },
    { jobId: `${eventId}:duplicate-test:3` }
  )
]);

console.log(
  `Added 3 duplicate jobs for event=${eventId} attempt=${attemptNumber}`
);

await deliveryQueue.close();