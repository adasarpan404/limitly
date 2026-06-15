# limitly

Distributed, Redis-powered rate limiting for Express, Fastify, Hono, Koa, Bun, and NestJS.

> Express-rate-limit, but distributed, Redis-powered, and production ready.

## Install

```bash
npm install limitly ioredis

# NestJS
npm install limitly ioredis @nestjs/common @nestjs/core
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

### Hono

```typescript
import { Hono } from "hono";
import Redis from "ioredis";
import { createLimiter } from "limitly";

const app = new Hono();
const limiter = createLimiter({ redis: new Redis() });

app.use(
  "*",
  limiter.honoMiddleware({
    algorithm: "sliding-window",
    limit: 100,
    window: 60,
    key: (c) => c.req.header("x-api-key"),
  })
);
```

### Koa

```typescript
import Koa from "koa";
import Redis from "ioredis";
import { createLimiter } from "limitly";

const app = new Koa();
const limiter = createLimiter({ redis: new Redis() });

app.use(
  limiter.koaMiddleware({
    algorithm: "sliding-window",
    limit: 100,
    window: 60,
    key: (ctx) => ctx.ip,
  })
);
```

### Bun

```typescript
import Redis from "ioredis";
import { composeBunHandler, createLimiter } from "limitly";

const limiter = createLimiter({ redis: new Redis() });

const rateLimit = limiter.bunMiddleware({
  algorithm: "sliding-window",
  limit: 100,
  window: 60,
  key: (req) => req.headers.get("x-api-key"),
});

const fetch = composeBunHandler(
  [rateLimit],
  () => Response.json({ message: "Hello Bun!" })
);

Bun.serve({ port: 3000, fetch });
```

### NestJS

```typescript
import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import Redis from "ioredis";
import { createLimiter } from "limitly";
import { RateLimit } from "limitly/nest";

const limiter = createLimiter({ redis: new Redis() });
const NestGuard = limiter.nestGuard({
  algorithm: "sliding-window",
  limit: 100,
  window: 60,
  key: (req) => req.ip,
});

@Module({
  providers: [{ provide: APP_GUARD, useClass: NestGuard }],
})
export class AppModule {}
```

Per-route limits with `@RateLimit()`:

```typescript
import { Controller, Get } from "@nestjs/common";
import { RateLimit } from "limitly/nest";

@Controller("api")
export class ApiController {
  @Get()
  @RateLimit({ algorithm: "sliding-window", limit: 10, window: 60 })
  findAll() {
    return { ok: true };
  }
}
```

Module helper (like `redisLimitPlugin` for Fastify):

```typescript
import { limitlyNestModule } from "limitly/nest";

@Module({
  imports: [
    limitlyNestModule({
      limiter,
      algorithm: "token-bucket",
      capacity: 50,
      refillRate: 10,
      global: true,
    }),
  ],
})
export class AppModule {}
```

## Default Algorithm

If you omit algorithm options, limitly uses **sliding-window** with `limit: 100` and `window: 60`:

```typescript
const limiter = createLimiter({ redis: new Redis() });

app.use(limiter.middleware({ key: (req) => req.ip }));

// equivalent to:
app.use(
  limiter.middleware({
    algorithm: "sliding-window",
    limit: 100,
    window: 60,
    key: (req) => req.ip,
  })
);
```

Set limiter-wide defaults:

```typescript
const limiter = createLimiter({
  redis: new Redis(),
  default: { limit: 50, window: 30 },
});

app.use(limiter.middleware({ key: (req) => req.ip }));
```

## Algorithms

### Sliding Window

Uses Redis Sorted Sets (or Memcached counters) for rate limiting over a rolling time window.

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

## Storage Backends

limitly supports Redis, Valkey, DragonflyDB (Redis-compatible), and Memcached.

### Redis / Valkey / DragonflyDB

Redis-compatible backends use atomic Lua scripts (sorted sets + hashes). Connect with `ioredis`:

```typescript
import Redis from "ioredis";

// Redis
createLimiter({ redis: new Redis() });

// Valkey
createLimiter({ store: "valkey", redis: "redis://localhost:6379" });

// DragonflyDB
createLimiter({ store: "dragonfly", redis: { host: "localhost", port: 6379 } });

// Cluster
createLimiter({
  store: "redis",
  redis: { nodes: [{ host: "127.0.0.1", port: 7000 }] },
});
```

### Memcached

Memcached uses counter-based sliding window and CAS token bucket (no Lua required):

```typescript
import Memcached from "memcached";

createLimiter({
  store: "memcached",
  memcached: "localhost:11211",
});

// Or pass an existing client
createLimiter({ memcached: new Memcached(["localhost:11211"]) });
```

> Memcached sliding window uses a weighted two-window counter (high accuracy, no sorted sets).
> Token bucket uses `gets`/`cas` for atomic updates.

## Key Extraction

The `key` option identifies **who** is being rate limited (per request):

```typescript
// IP-based
key: (req) => req.ip;

// API Key
key: (req) => req.headers["x-api-key"];

// User ID
key: (req) => req.user.id;
```

## Storage Key Prefix

The `keyPrefix` option controls **where** counters are stored in Redis/Memcached.
Default is `limitly`:

```typescript
createLimiter({ redis: new Redis() });
// stores keys like: limitly:sw:203.0.113.1

createLimiter({
  redis: new Redis(),
  keyPrefix: "myapp:prod",
});
// stores keys like: myapp:prod:sw:203.0.113.1
```

Key format:

```
{keyPrefix}:sw:{id}   — sliding window
{keyPrefix}:tb:{id}   — token bucket
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
