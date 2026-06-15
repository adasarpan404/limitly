import Fastify from "fastify";
import Redis from "ioredis";
import { createLimiter } from "limitly";
import { createMetricsHook } from "../shared/metrics.js";

const fastify = Fastify({ logger: false });
const redis = new Redis();
const { onMetrics } = createMetricsHook("fastify");

// Case 5: failOpen=true — if Redis goes down, traffic is allowed through instead of erroring
// Global onMetrics fires for plugin middleware and limiter.check() calls
const limiter = createLimiter({ redis, failOpen: true, onMetrics });

// Case 1: Global token-bucket rate limit keyed by IP
// Covers all routes; allows bursts up to 50 tokens, refills at 10/sec
await fastify.register(limiter.fastifyPlugin, {
  algorithm: "token-bucket",
  capacity: 50,
  refillRate: 10,
  key: (req) => req.ip,
});

// Case 2: Sliding-window check in the route handler (anti-brute-force login)
// 5 requests per 10-second window per IP; returns structured error JSON on block
fastify.post("/auth/login", async (req, reply) => {
  const result = await limiter.check(req.ip ?? "unknown", {
    algorithm: "sliding-window",
    limit: 5,
    window: 10,
  });

  if (!result.allowed) {
    return reply.status(429).send({
      error: "Too many login attempts",
      retryAfter: result.retryAfter,
    });
  }

  return { message: "Login successful (demo)" };
});

// Case 3: Token-bucket keyed by x-api-key header instead of IP
// Each API key gets its own bucket (100 capacity, 20 refill/sec); headers forwarded manually
fastify.get("/api/data", async (req, reply) => {
  const key = req.headers["x-api-key"] ?? req.ip ?? "unknown";

  const result = await limiter.check(key, {
    algorithm: "token-bucket",
    capacity: 100,
    refillRate: 20,
  });

  reply.headers({
    "x-ratelimit-limit": result.limit,
    "x-ratelimit-remaining": result.remaining,
    "x-ratelimit-reset": result.reset,
  });

  if (!result.allowed) {
    return reply.status(429).send({
      error: "Rate limit exceeded",
      retryAfter: result.retryAfter,
    });
  }

  return { data: "Your API response here", key };
});

// Case 4: Scoped plugin with sliding-window and a custom onLimitReached handler
// Only applies to routes registered inside this scope
await fastify.register(async (scope) => {
  await scope.register(limiter.fastifyPlugin, {
    algorithm: "sliding-window",
    limit: 3,
    window: 30,
    key: (req) => req.ip,
    onLimitReached: async (_req, reply) => {
      reply.status(429).send({
        error: "Admin rate limit reached",
        message: "Max 3 requests per 30 seconds in the admin area",
      });
    },
  });

  scope.get("/admin/dashboard", async () => {
    return { data: "Admin dashboard data" };
  });
});

// Index route — documents available cases
fastify.get("/", async () => {
  return {
    routes: {
      "POST /auth/login": "sliding-window, 5 req/10s per IP (anti-brute-force)",
      "GET /api/data": "token-bucket keyed by x-api-key header, 100 cap / 20 refill",
      "GET /admin/dashboard": "sliding-window, 3 req/30s, custom 429 handler",
      "GET /": "covered by global token-bucket (50 cap / 10 refill per IP)",
    },
    note: "failOpen=true: Redis failures allow traffic through instead of returning 503; onMetrics logs allowed/blocked/error/fail_open to stdout",
  };
});

await fastify.listen({ port: 3001 });
console.log("Fastify example running on http://localhost:3001");
console.log("");
console.log("Cases:");
console.log("  Case 1 — token-bucket (global, IP):       GET  /");
console.log("  Case 2 — sliding-window (login guard):    POST /auth/login");
console.log("  Case 3 — token-bucket (API-key):          GET  /api/data");
console.log("  Case 4 — sliding-window (custom handler): GET  /admin/dashboard");
console.log("  Case 5 — failOpen=true + global onMetrics on createLimiter");
