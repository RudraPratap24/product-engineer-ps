import "dotenv/config";
import express from "express";
import { startRecoveryWorker } from "./queue/recovery.worker.js";
import eventRoutes from "./api/event.routes.js";
import "./queue/delivery.worker.js";

const app = express();

app.use(express.json());

app.get("/health", (req, res) => {
  res.json({
    status: "ok"
  });
});

app.use(eventRoutes);

app.use((error, req, res, next) => {
  console.error(error);

  res.status(500).json({
    error: "Internal server error"
  });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Webhook engine running on port ${PORT}`);
});

startRecoveryWorker();