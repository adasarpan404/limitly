# limitly

Distributed, Redis-powered rate limiting for Express, Fastify, Hono, Koa, Bun, and NestJS.

> Express-rate-limit, but distributed, Redis-powered, and production ready.

## Install

```bash
npm install limitly ioredis

# Memcached backend
npm install limitly memcached

# OpenTelemetry
npm install limitly ioredis @opentelemetry/api

# Prometheus
npm install limitly ioredis prom-client

# NestJS
npm install limitly ioredis @nestjs/common @nestjs/core
```

Framework-specific subpath imports are available for tree-shaking:

```typescript
import { createExpressMiddleware } from "limitly/express";
import { createFastifyPlugin } from "limitly/fastify";
import { createHonoMiddleware } from "limitly/hono";
import { createKoaMiddleware } from "limitly/koa";
import { createBunMiddleware } from "limitly/bun";
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

app.use(limiter.middleware({ key: (req) => req.ip }));
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

app.use("*", limiter.honoMiddleware({ key: (c) => c.req.header("x-api-key") }));
```

### Koa

```typescript
import Koa from "koa";
import Redis from "ioredis";
import { createLimiter } from "limitly";

const app = new Koa();
const limiter = createLimiter({ redis: new Redis() });

app.use(limiter.koaMiddleware({ key: (ctx) => ctx.ip }));
```

### Bun

```typescript
import Redis from "ioredis";
import { composeBunHandler, createLimiter } from "limitly";

const limiter = createLimiter({ redis: new Redis() });

const rateLimit = limiter.bunMiddleware({
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
  @RateLimit({ limit: 10, window: 60 })
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

If you omit algorithm options, limitly uses **GCRA** with `limit: 100` and `window: 60`:

```typescript
const limiter = createLimiter({ redis: new Redis() });

app.use(limiter.middleware({ key: (req) => req.ip }));

// equivalent to:
app.use(
  limiter.middleware({
    algorithm: "gcra",
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

## Programmatic Checks

Use `limiter.check()` outside middleware — useful for login guards, background jobs, or custom response handling:

```typescript
const result = await limiter.check(req.ip ?? "unknown", {
  limit: 5,
  window: 10,
});

if (!result.allowed) {
  return res.status(429).json({
    error: "Too many attempts",
    retryAfter: result.retryAfter,
  });
}
```

`check()` respects limiter-wide defaults, `failOpen`, and global `onMetrics` hooks.

## Algorithms

### GCRA (default)

Generic Cell Rate Algorithm — smooth rate limiting with controlled bursts. Uses a single TAT (theoretical arrival time) per key, so it's memory-efficient compared to sliding window:

```typescript
limiter.middleware({
  limit: 100,
  window: 60, // seconds — algorithm defaults to gcra
  key: (req) => req.ip,
});
```

GCRA enforces an average rate of `limit / window` while allowing short bursts up to `limit`. Ideal when you want token-bucket-like behavior with predictable storage costs.

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

### Concurrency

Limits simultaneous in-flight requests per key. Slots are acquired on entry and released when the response finishes (middleware handles this automatically):

```typescript
limiter.middleware({
  algorithm: "concurrency",
  limit: 10, // max concurrent requests
  ttl: 300, // lease TTL in seconds for stale slot cleanup
  key: (req) => req.ip,
});
```

For manual acquire/release outside middleware:

```typescript
const acquired = await limiter.acquire("job-42", {
  algorithm: "concurrency",
  limit: 5,
  ttl: 120,
});

if (!acquired.allowed) {
  throw new Error("Too many concurrent jobs");
}

try {
  await runJob();
} finally {
  await limiter.release("job-42", acquired.slotId!, {
    algorithm: "concurrency",
    limit: 5,
    ttl: 120,
  });
}
```

Storage keys use the `cc:` prefix: `{keyPrefix}:cc:{id}`.

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

// Cluster (auto-pipelining, script warmup, master reads)
createLimiter({
  store: "redis",
  redis: {
    nodes: [
      { host: "127.0.0.1", port: 7000 },
      { host: "127.0.0.1", port: 7001 },
    ],
    options: {
      redisOptions: { password: "secret" },
    },
  },
});

// Optional: pin all keys to one slot (use only when you need co-location)
createLimiter({
  redis: { nodes: [{ host: "127.0.0.1", port: 7000 }] },
  hashTag: "limitly",
});
```

Cluster optimizations built into limitly:

- **ioredis `defineCommand`** — Lua scripts are registered cluster-aware, avoiding per-node `NOSCRIPT` fallbacks
- **Script warmup** — scripts are preloaded on all master nodes at startup (disable with `warmupScripts: false`)
- **Auto-pipelining** — enabled by default for higher throughput under concurrent load
- **Hash tags** — optional `hashTag` for slot pinning; leave unset to spread keys across slots (recommended)
- **Master reads** — `scaleReads: "master"` by default so checks always hit the authoritative node

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
{keyPrefix}:gcra:{id} — GCRA
{keyPrefix}:cc:{id}   — concurrency
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
  onLimitReached(req, res) {
    res.status(429).json({ code: "RATE_LIMITED" });
  },
});
```

## Metrics

Emit observability events via the `onMetrics` hook. Set it globally on the limiter or per middleware/route:

```typescript
const limiter = createLimiter({
  redis: new Redis(),
  onMetrics: (event) => {
    console.log(event.type, event.key, `${event.durationMs.toFixed(2)}ms`);
  },
});

// Per-route override
limiter.middleware({
  onMetrics: (event) => metrics.increment(`ratelimit.${event.type}`),
});
```

Event types:

| Type | When |
|------|------|
| `allowed` | Request passed the rate limit check |
| `blocked` | Request exceeded the limit |
| `error` | Store operation failed |
| `fail_open` | Store failed but `failOpen: true` allowed traffic through |

Each event includes `key`, `algorithm`, `durationMs`, and optionally `store`, `context` (the request object), and `result` or `error` depending on type.

Multiple hooks are supported:

```typescript
onMetrics: [logToConsole, sendToDatadog]
```

`limiter.check()` and all framework middleware use the same metrics pipeline.

## OpenTelemetry

Use the `limitly/otel` helpers to emit OTEL metrics and traces. Only `@opentelemetry/api` is required — bring your own SDK/exporter:

```typescript
import Redis from "ioredis";
import { createLimiter } from "limitly";
import { createOpenTelemetryInstrumentation } from "limitly/otel";

const otel = createOpenTelemetryInstrumentation();

const limiter = createLimiter({
  redis: new Redis(),
  tracer: otel.tracer,
  onMetrics: otel.onMetrics,
});

app.use(limiter.middleware({ key: (req) => req.ip }));
```

`createOpenTelemetryInstrumentation()` returns:

- **`tracer`** — creates `limitly.check` spans with `limitly.algorithm`, `limitly.store`, `limitly.outcome`, `limitly.limit`, and `limitly.remaining` attributes
- **`onMetrics`** — records `limitly.check.total` (counter) and `limitly.check.duration` (histogram, ms)

Use the pieces independently when needed:

```typescript
import {
  createOpenTelemetryMetricsHook,
  createOpenTelemetryTracer,
} from "limitly/otel";

const limiter = createLimiter({
  redis: new Redis(),
  tracer: createOpenTelemetryTracer(),
  onMetrics: createOpenTelemetryMetricsHook({ includeKey: false }),
});
```

Combine with custom hooks:

```typescript
onMetrics: [otel.onMetrics, customHook]
```

## Prometheus

Use `limitly/prometheus` to expose rate limit metrics for scraping:

```typescript
import express from "express";
import Redis from "ioredis";
import { createLimiter } from "limitly";
import {
  createPrometheusExporter,
  createPrometheusHandler,
} from "limitly/prometheus";

const app = express();
const prometheus = createPrometheusExporter();

const limiter = createLimiter({
  redis: new Redis(),
  onMetrics: prometheus.onMetrics,
});

app.use(limiter.middleware({ key: (req) => req.ip }));
app.get("/metrics", createPrometheusHandler(prometheus));
```

Metrics exposed:

| Metric | Type | Labels |
|--------|------|--------|
| `limitly_check_total` | Counter | `algorithm`, `outcome`, `store` |
| `limitly_check_duration_seconds` | Histogram | `algorithm`, `outcome`, `store` |

`outcome` is one of `allowed`, `blocked`, `error`, or `fail_open`.

Options:

| Option | Default | Description |
|--------|---------|-------------|
| `register` | new `Registry` | Prometheus registry |
| `prefix` | `"limitly"` | Metric name prefix |
| `includeKey` | `false` | Add rate limit key as a label (high cardinality) |
| `durationBuckets` | `[0.001, 0.005, 0.01, …, 1]` | Histogram buckets (seconds) |

Use a shared registry with your existing metrics:

```typescript
import { Registry } from "prom-client";

const register = new Registry();
const prometheus = createPrometheusExporter({ register });

onMetrics: [prometheus.onMetrics, otherHook];
```

Scrape manually without HTTP middleware:

```typescript
const body = await prometheus.getMetrics();
```

Use `createPrometheusMetricsHook` when you only need the `onMetrics` hook without the HTTP handler:

```typescript
import { createPrometheusMetricsHook } from "limitly/prometheus";

const limiter = createLimiter({
  redis: new Redis(),
  onMetrics: createPrometheusMetricsHook({ prefix: "api" }),
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
  release?(key: string, slotId: string): Promise<void>;
}
```

`release` is optional — only needed for concurrency-style strategies that hold a slot until the response finishes.

## Performance

- Atomic operations via Lua scripts (`EVALSHA`)
- Automatic key cleanup with `EXPIRE`
- P95 < 5ms per check (excluding network latency)
- 20,000+ checks/sec on a single Redis node

## License

MIT
