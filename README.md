# limitly

Distributed, Redis-powered rate limiting for Express and Fastify.

> Express-rate-limit, but distributed, Redis-powered, and production ready.

## Install

```bash
npm install limitly ioredis
```

## Quick Start

### Express

```typescript
import express from "express";
import Redis from "ioredis";
import { createLimiter } from "limitly";

const app = express();
const redis = new Redis();
const limiter = createLimiter({ redis });

app.use(
  limiter.middleware({
    algorithm: "sliding-window",
    limit: 100,
    window: 60,
    key: (req) => req.ip,
  }),
);
```

### Fastify

```typescript
import Fastify from "fastify";
import Redis from "ioredis";
import { createLimiter } from "limitly";

const fastify = Fastify();
const limiter = createLimiter({ redis: new Redis() });

await fastify.register(limiter.fastifyPlugin, {
  algorithm: "token-bucket",
  capacity: 50,
  refillRate: 10,
  key: (req) => req.ip,
});
```

## Algorithms

### Sliding Window

Uses Redis Sorted Sets for precise rate limiting over a rolling time window.

```typescript
limiter.middleware({
  algorithm: "sliding-window",
  limit: 100,
  window: 60, // seconds
});
```

### Token Bucket

Supports burst traffic with configurable refill rate.

```typescript
limiter.middleware({
  algorithm: "token-bucket",
  capacity: 100,
  refillRate: 10, // tokens per second
});
```

## Redis Connection

Supports multiple connection modes:

```typescript
// Existing Redis instance
createLimiter({ redis: new Redis() });

// Connection URL
createLimiter({ redis: "redis://localhost:6379" });

// Options object
createLimiter({ redis: { host: "localhost", port: 6379 } });

// Cluster
createLimiter({
  redis: {
    nodes: [{ host: "127.0.0.1", port: 7000 }],
  },
});
```

## Key Extraction

```typescript
// IP-based
key: (req) => req.ip;

// API Key
key: (req) => req.headers["x-api-key"];

// User ID
key: (req) => req.user.id;
```

## Response Headers

Standard rate limit headers are set by default:

```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 45
X-RateLimit-Reset: 1710000000
Retry-After: 15
```

Disable with `headers: false`.

## Custom Limit Response

```typescript
limiter.middleware({
  algorithm: "sliding-window",
  limit: 100,
  window: 60,
  onLimitReached(req, res) {
    res.status(429).json({ code: "RATE_LIMITED" });
  },
});
```

## Fail Open / Closed

When Redis is unavailable:

```typescript
createLimiter({
  redis: new Redis(),
  failOpen: true, // allow traffic (default)
  // failOpen: false, // block with 503
});
```

## Extensibility

Implement custom algorithms with the `RateLimitStrategy` interface:

```typescript
interface RateLimitStrategy {
  consume(key: string): Promise<RateLimitResult>;
}
```

## Performance

- Atomic operations via Lua scripts (`EVALSHA`)
- Automatic key cleanup with `EXPIRE`
- P95 < 5ms per check (excluding network latency)
- 20,000+ checks/sec on a single Redis node

## License

MIT
