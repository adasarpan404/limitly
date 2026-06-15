import express from "express";
import Redis from "ioredis";
import { createLimiter } from "redislimit";

const app = express();
const redis = new Redis();
const limiter = createLimiter({ redis });

app.use(
  limiter.middleware({
    algorithm: "sliding-window",
    limit: 10,
    window: 60,
    key: (req) => req.ip,
  }),
);

app.get("/", (_req, res) => {
  res.json({ message: "Hello from redislimit!" });
});

app.listen(3000, () => {
  console.log("Express example running on http://localhost:3000");
});
