import "dotenv/config";

import {
  recoverStaleDeliveries,
  dispatchPendingEvents,
} from "../services/recovery.service.js";

const RECOVERY_INTERVAL_MS = 10000;

export async function startRecoveryWorker() {
  await recoverStaleDeliveries();
  await dispatchPendingEvents();

  setInterval(async () => {
    try {
      await recoverStaleDeliveries();
      await dispatchPendingEvents();
    } catch (error) {
      console.error(
        "[RECOVERY] worker_error",
        error
      );
    }
  }, RECOVERY_INTERVAL_MS);
}