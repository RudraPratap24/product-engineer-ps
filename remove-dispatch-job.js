import { deliveryQueue } from "./src/queue/delivery.queue.js";

const job = await deliveryQueue.getJob("evt_dispatch_001:attempt:1");

if (!job) {
  console.log("Job not found");
} else {
  console.log("Found job:", job.id, job.data);
  await job.remove();
  console.log("Removed job:", job.id);
}

await deliveryQueue.close();
