import type { Context, Next } from "koa";
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { RedisLimit } from "../src/limiter";
import { createKoaMiddleware } from "../src/middleware/koa";

function createMockContext(overrides?: { ip?: string }): Context {
  const headers = new Map<string, string>();

  return {
    ip: overrides?.ip,
    request: { headers: {} },
    response: {},
    status: 200,
    body: undefined,
    set: (name: string, value: string) => {
      headers.set(name, value);
    },
    _headers: headers,
  } as unknown as Context & { _headers: Map<string, string> };
}

describe("createKoaMiddleware", () => {
  let limiter: RedisLimit;
  let consume: ReturnType<typeof vi.fn>;
  let next: Next;

  beforeEach(() => {
    consume = vi.fn();
    limiter = {
      createStrategy: vi.fn(() => ({ consume })),
    } as unknown as RedisLimit;
    next = vi.fn();
  });

  it("allows request under the limit", async () => {
    consume.mockResolvedValue({
      allowed: true,
      limit: 100,
      remaining: 99,
      reset: 1710000000,
    });

    const middleware = createKoaMiddleware(limiter)({
      algorithm: "sliding-window",
      limit: 100,
      window: 60,
    });

    const ctx = createMockContext();
    await middleware(ctx, next);

    expect(consume).toHaveBeenCalledWith("unknown");
    expect(next).toHaveBeenCalled();
  });

  it("uses ctx.ip as default key", async () => {
    consume.mockResolvedValue({
      allowed: true,
      limit: 100,
      remaining: 99,
      reset: 1710000000,
    });

    const middleware = createKoaMiddleware(limiter)({
      algorithm: "sliding-window",
      limit: 100,
      window: 60,
    });

    const ctx = createMockContext({ ip: "203.0.113.1" });
    await middleware(ctx, next);

    expect(consume).toHaveBeenCalledWith("203.0.113.1");
  });

  it("returns 429 when rate limit is exceeded", async () => {
    consume.mockResolvedValue({
      allowed: false,
      limit: 1,
      remaining: 0,
      reset: 1710000060,
      retryAfter: 30,
    });

    const middleware = createKoaMiddleware(limiter)({
      algorithm: "sliding-window",
      limit: 1,
      window: 60,
    });

    const ctx = createMockContext();
    await middleware(ctx, next);

    expect(ctx.status).toBe(429);
    expect(ctx.body).toEqual({ error: "Too Many Requests" });
    expect(next).not.toHaveBeenCalled();
  });

  it("sets rate limit headers", async () => {
    consume.mockResolvedValue({
      allowed: true,
      limit: 100,
      remaining: 45,
      reset: 1710000000,
    });

    const middleware = createKoaMiddleware(limiter)({
      algorithm: "sliding-window",
      limit: 100,
      window: 60,
    });

    const ctx = createMockContext({ ip: "127.0.0.1" });
    await middleware(ctx, next);

    const context = ctx as Context & { _headers: Map<string, string> };
    expect(context._headers.get("X-RateLimit-Limit")).toBe("100");
    expect(context._headers.get("X-RateLimit-Remaining")).toBe("45");
    expect(context._headers.get("X-RateLimit-Reset")).toBe("1710000000");
  });

  it("failOpen allows traffic on Redis error", async () => {
    consume.mockRejectedValue(new Error("Redis down"));

    const middleware = createKoaMiddleware(limiter)({
      algorithm: "sliding-window",
      limit: 100,
      window: 60,
      failOpen: true,
    });

    const ctx = createMockContext();
    await middleware(ctx, next);

    expect(next).toHaveBeenCalled();
  });

  it("skips headers when headers: false", async () => {
    consume.mockResolvedValue({
      allowed: true,
      limit: 100,
      remaining: 99,
      reset: 1710000000,
    });

    const middleware = createKoaMiddleware(limiter)({
      algorithm: "sliding-window",
      limit: 100,
      window: 60,
      headers: false,
    });

    const ctx = createMockContext({ ip: "127.0.0.1" });
    await middleware(ctx, next);

    const context = ctx as Context & { _headers: Map<string, string> };
    expect(context._headers.size).toBe(0);
  });

  it("calls onLimitReached when rate limited", async () => {
    consume.mockResolvedValue({
      allowed: false,
      limit: 1,
      remaining: 0,
      reset: 1710000060,
    });

    const onLimitReached = vi.fn();
    const middleware = createKoaMiddleware(limiter)({
      algorithm: "sliding-window",
      limit: 1,
      window: 60,
      onLimitReached,
    });

    const ctx = createMockContext();
    await middleware(ctx, next);

    expect(onLimitReached).toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  it("sets Retry-After header when rate limited", async () => {
    consume.mockResolvedValue({
      allowed: false,
      limit: 1,
      remaining: 0,
      reset: 1710000060,
      retryAfter: 20,
    });

    const middleware = createKoaMiddleware(limiter)({
      algorithm: "sliding-window",
      limit: 1,
      window: 60,
    });

    const ctx = createMockContext();
    await middleware(ctx, next);

    const context = ctx as Context & { _headers: Map<string, string> };
    expect(context._headers.get("Retry-After")).toBe("20");
  });

  it("returns 503 when failOpen is false and Redis fails", async () => {
    consume.mockRejectedValue(new Error("Redis down"));

    const middleware = createKoaMiddleware(limiter)({
      algorithm: "sliding-window",
      limit: 100,
      window: 60,
      failOpen: false,
    });

    const ctx = createMockContext();
    await middleware(ctx, next);

    expect(ctx.status).toBe(503);
    expect(ctx.body).toEqual({ error: "Service Unavailable" });
    expect(next).not.toHaveBeenCalled();
  });
});