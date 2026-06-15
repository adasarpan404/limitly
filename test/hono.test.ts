import type { Context, Next } from "hono";
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { RedisLimit } from "../src/limiter";
import { createHonoMiddleware } from "../src/middleware/hono";

function createMockContext(overrides?: {
  headers?: Record<string, string>;
}): Context {
  const headers = new Map(
    Object.entries(overrides?.headers ?? {}).map(([k, v]) => [
      k.toLowerCase(),
      v,
    ])
  );
  const responseHeaders = new Map<string, string>();

  return {
    req: {
      raw: { headers: overrides?.headers ?? {} },
      header: (name: string) => headers.get(name.toLowerCase()),
    },
    header: (name: string, value: string) => {
      responseHeaders.set(name, value);
      return undefined;
    },
    json: vi.fn((body: unknown, status?: number) => ({
      body,
      status,
      headers: responseHeaders,
    })),
    _responseHeaders: responseHeaders,
  } as unknown as Context & { _responseHeaders: Map<string, string> };
}

describe("createHonoMiddleware", () => {
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

    const middleware = createHonoMiddleware(limiter)({
      algorithm: "sliding-window",
      limit: 100,
      window: 60,
    });

    const c = createMockContext();
    await middleware(c, next);

    expect(consume).toHaveBeenCalledWith("unknown");
    expect(next).toHaveBeenCalled();
  });

  it("extracts IP from x-forwarded-for", async () => {
    consume.mockResolvedValue({
      allowed: true,
      limit: 100,
      remaining: 99,
      reset: 1710000000,
    });

    const middleware = createHonoMiddleware(limiter)({
      algorithm: "sliding-window",
      limit: 100,
      window: 60,
    });

    const c = createMockContext({
      headers: { "x-forwarded-for": "203.0.113.1, 70.41.3.18" },
    });
    await middleware(c, next);

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

    const middleware = createHonoMiddleware(limiter)({
      algorithm: "sliding-window",
      limit: 1,
      window: 60,
    });

    const c = createMockContext();
    const result = await middleware(c, next);

    expect(result).toEqual({
      body: { error: "Too Many Requests" },
      status: 429,
      headers: expect.any(Map),
    });
    expect(next).not.toHaveBeenCalled();
  });

  it("sets rate limit headers", async () => {
    consume.mockResolvedValue({
      allowed: true,
      limit: 100,
      remaining: 45,
      reset: 1710000000,
    });

    const middleware = createHonoMiddleware(limiter)({
      algorithm: "sliding-window",
      limit: 100,
      window: 60,
    });

    const c = createMockContext();
    await middleware(c, next);

    const ctx = c as Context & { _responseHeaders: Map<string, string> };
    expect(ctx._responseHeaders.get("X-RateLimit-Limit")).toBe("100");
    expect(ctx._responseHeaders.get("X-RateLimit-Remaining")).toBe("45");
    expect(ctx._responseHeaders.get("X-RateLimit-Reset")).toBe("1710000000");
  });

  it("failOpen allows traffic on Redis error", async () => {
    consume.mockRejectedValue(new Error("Redis down"));

    const middleware = createHonoMiddleware(limiter)({
      algorithm: "sliding-window",
      limit: 100,
      window: 60,
      failOpen: true,
    });

    const c = createMockContext();
    await middleware(c, next);

    expect(next).toHaveBeenCalled();
  });

  it("uses x-real-ip when x-forwarded-for is absent", async () => {
    consume.mockResolvedValue({
      allowed: true,
      limit: 100,
      remaining: 99,
      reset: 1710000000,
    });

    const middleware = createHonoMiddleware(limiter)({
      algorithm: "sliding-window",
      limit: 100,
      window: 60,
    });

    const c = createMockContext({ headers: { "x-real-ip": "198.51.100.1" } });
    await middleware(c, next);

    expect(consume).toHaveBeenCalledWith("198.51.100.1");
  });

  it("skips headers when headers: false", async () => {
    consume.mockResolvedValue({
      allowed: true,
      limit: 100,
      remaining: 99,
      reset: 1710000000,
    });

    const middleware = createHonoMiddleware(limiter)({
      algorithm: "sliding-window",
      limit: 100,
      window: 60,
      headers: false,
    });

    const c = createMockContext();
    await middleware(c, next);

    const ctx = c as Context & { _responseHeaders: Map<string, string> };
    expect(ctx._responseHeaders.size).toBe(0);
  });

  it("calls onLimitReached when rate limited", async () => {
    consume.mockResolvedValue({
      allowed: false,
      limit: 1,
      remaining: 0,
      reset: 1710000060,
    });

    const onLimitReached = vi.fn();
    const middleware = createHonoMiddleware(limiter)({
      algorithm: "sliding-window",
      limit: 1,
      window: 60,
      onLimitReached,
    });

    const c = createMockContext();
    await middleware(c, next);

    expect(onLimitReached).toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 503 when failOpen is false and Redis fails", async () => {
    consume.mockRejectedValue(new Error("Redis down"));

    const middleware = createHonoMiddleware(limiter)({
      algorithm: "sliding-window",
      limit: 100,
      window: 60,
      failOpen: false,
    });

    const c = createMockContext();
    const result = await middleware(c, next);

    expect(result).toEqual({
      body: { error: "Service Unavailable" },
      status: 503,
      headers: expect.any(Map),
    });
    expect(next).not.toHaveBeenCalled();
  });
});