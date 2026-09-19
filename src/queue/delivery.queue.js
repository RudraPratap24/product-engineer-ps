import { Queue } from "bullmq";

import { redisConnection } from "../infrastructure/redis.js";

export const deliveryQueue = new Queue(
  "webhook-delivery",
  {
    connection: redisConnection,
    defaultJobOptions: {
      removeOnComplete: true,
      removeOnFail: true,
    },
  }
);