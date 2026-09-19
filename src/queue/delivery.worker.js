import "dotenv/config";

import { Worker } from "bullmq";

import { redisConnection } from "../infrastructure/redis.js";
import { deliveryQueue } from "./delivery.queue.js";
import { deliverEvent } from "../services/delivery.service.js";

export const deliveryWorker = new Worker(
  "webhook-delivery",
  async (job) => {
    const {
      eventId,
      attemptNumber,
    } = job.data;

    const result = await deliverEvent(
      eventId,
      attemptNumber
    );

    if (result.skipped) {
      return;
    }

    const event = result.event;

    if (event.status !== "RETRYING") {
      return;
    }

    const nextAttemptNumber =
      attemptNumber + 1;

    const delay = Math.max(
      0,
      new Date(
        event.nextAttemptAt
      ).getTime() - Date.now()
    );

    const jobId =
      `${eventId}:attempt:${nextAttemptNumber}`;

    const existingJob =
      await deliveryQueue.getJob(jobId);

    if (existingJob) {
      return;
    }

    await deliveryQueue.add(
      "deliver-webhook",
      {
        eventId,
        attemptNumber:
          nextAttemptNumber,
      },
      {
        delay,
        jobId,
      }
    );
  },
  {
    connection: redisConnection,
    concurrency: 5,
  }
);

deliveryWorker.on(
  "failed",
  (job, error) => {
    console.error(
      `[WORKER] job_failed event=${
        job?.data?.eventId ?? "unknown"
      }`,
      error
    );
  }
);
