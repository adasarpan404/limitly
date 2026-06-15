import express from "express";
import Redis from "ioredis";
import { createLimiter } from "limitly";
import { createMetricsHook } from "../shared/metrics.js";

const app = express();
const redis = new Redis();
const { onMetrics } = createMetricsHook("express");

const limiter = createLimiter({ redis, onMetrics });

app.use(
  limiter.middleware({
    algorithm: "sliding-window",
    limit: 10,
    window: 60,
    key: (req) => req.ip,
  }),
);

app.get("/", (_req, res) => {
  res.json({ message: "Hello from limitly!" });
});

app.listen(3000, () => {
  console.log("Express example running on http://localhost:3000");
});
