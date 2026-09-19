import express from "express";

const app = express();

app.use(express.json());

let mode = "SUCCESS";

app.post("/control/mode", (req, res) => {
  const allowedModes = [
    "SUCCESS",
    "FAIL_400",
    "FAIL_500",
    "FAIL_503",
    "TIMEOUT"
  ];

  const { mode: requestedMode } = req.body;

  if (!allowedModes.includes(requestedMode)) {
    return res.status(400).json({
      error: "Invalid mode",
      allowedModes
    });
  }

  mode = requestedMode;

  return res.json({
    mode
  });
});

app.get("/control/mode", (req, res) => {
  res.json({ mode });
});

app.post("/webhook", async (req, res) => {
  console.log("Webhook received:", {
    mode,
    payload: req.body
  });

  if (mode === "SUCCESS") {
    return res.status(200).json({
      received: true
    });
  }

  if (mode === "FAIL_400") {
    return res.status(400).json({
      error: "Permanent failure"
    });
  }

  if (mode === "FAIL_500") {
    return res.status(500).json({
      error: "Temporary server failure"
    });
  }

  if (mode === "FAIL_503") {
    return res.status(503).json({
      error: "Service unavailable"
    });
  }

  if (mode === "TIMEOUT") {
    await new Promise((resolve) => {
      setTimeout(resolve, 10000);
    });

    return res.status(200).json({
      received: true
    });
  }
});

const PORT = process.env.RECEIVER_PORT || 4001;

app.listen(PORT, () => {
  console.log(`Mock webhook receiver running on port ${PORT}`);
});