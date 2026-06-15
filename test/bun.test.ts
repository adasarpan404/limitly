import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  applyRateLimitHeaders,
  composeBunHandler,
  createBunMiddleware,
  jsonResponse,
} from "../src/middleware/bun";
import { createMockLimiter } from "./helpers/mock-limiter";

describe("createBunMiddleware", () => {
  let consume: ReturnType<typeof vi.fn>;
  let limiter: ReturnType<typeof createMockLimiter>["limiter"];
  let next: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    ({ limiter, consume } = createMockLimiter());
    next = vi.fn(async () => Response.json({ ok: true }));
  });

  it("allows request under the limit", async () => {
    const middleware = createBunMiddleware(limiter)({
      algorithm: "sliding-window",
      limit: 100,
      window: 60,
    });

    const req = new Request("http://localhost/");
    const response = await middleware(req, next);

    expect(consume).toHaveBeenCalledWith("unknown");
    expect(next).toHaveBeenCalled();
    expect(response.status).toBe(200);
  });

  it("extracts IP from x-forwarded-for", async () => {
    const middleware = createBunMiddleware(limiter)({
      algorithm: "sliding-window",
      limit: 100,
      window: 60,
    });

    const req = new Request("http://localhost/", {
      headers: { "x-forwarded-for": "203.0.113.1, 70.41.3.18" },
    });
    await middleware(req, next);

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

    const middleware = createBunMiddleware(limiter)({
      algorithm: "sliding-window",
      limit: 1,
      window: 60,
    });

    const req = new Request("http://localhost/");
    const response = await middleware(req, next);
    const body = await response.json();

    expect(response.status).toBe(429);
    expect(body).toEqual({ error: "Too Many Requests" });
    expect(response.headers.get("Retry-After")).toBe("30");
    expect(next).not.toHaveBeenCalled();
  });

  it("applies rate limit headers to downstream response", async () => {
    consume.mockResolvedValue({
      allowed: true,
      limit: 100,
      remaining: 45,
      reset: 1710000000,
    });

    const middleware = createBunMiddleware(limiter)({
      algorithm: "sliding-window",
      limit: 100,
      window: 60,
    });

    const req = new Request("http://localhost/");
    const response = await middleware(req, next);

    expect(response.headers.get("X-RateLimit-Limit")).toBe("100");
    expect(response.headers.get("X-RateLimit-Remaining")).toBe("45");
    expect(response.headers.get("X-RateLimit-Reset")).toBe("1710000000");
  });

  it("skips headers when headers: false", async () => {
    const middleware = createBunMiddleware(limiter)({
      algorithm: "sliding-window",
      limit: 100,
      window: 60,
      headers: false,
    });

    const req = new Request("http://localhost/");
    const response = await middleware(req, next);

    expect(response.headers.get("X-RateLimit-Limit")).toBeNull();
  });

  it("failOpen allows traffic on store error", async () => {
    consume.mockRejectedValue(new Error("store down"));

    const middleware = createBunMiddleware(limiter)({
      algorithm: "sliding-window",
      limit: 100,
      window: 60,
      failOpen: true,
    });

    const req = new Request("http://localhost/");
    const response = await middleware(req, next);

    expect(next).toHaveBeenCalled();
    expect(response.status).toBe(200);
  });

  it("returns 503 when failOpen is false and store fails", async () => {
    consume.mockRejectedValue(new Error("store down"));

    const middleware = createBunMiddleware(limiter)({
      algorithm: "sliding-window",
      limit: 100,
      window: 60,
      failOpen: false,
    });

    const req = new Request("http://localhost/");
    const response = await middleware(req, next);

    expect(response.status).toBe(503);
    expect(next).not.toHaveBeenCalled();
  });

  it("calls onLimitReached when rate limited", async () => {
    consume.mockResolvedValue({
      allowed: false,
      limit: 1,
      remaining: 0,
      reset: 1710000060,
    });

    const onLimitReached = vi.fn();
    const middleware = createBunMiddleware(limiter)({
      algorithm: "sliding-window",
      limit: 1,
      window: 60,
      onLimitReached,
    });

    const req = new Request("http://localhost/");
    const response = await middleware(req, next);

    expect(onLimitReached).toHaveBeenCalled();
    expect(response.status).toBe(429);
    expect(next).not.toHaveBeenCalled();
  });
});

describe("composeBunHandler", () => {
  it("runs middleware chain then handler", async () => {
    const { limiter } = createMockLimiter();
    const rateLimit = createBunMiddleware(limiter)({
      algorithm: "sliding-window",
      limit: 100,
      window: 60,
    });

    const fetch = composeBunHandler(
      [rateLimit],
      () => Response.json({ message: "Hello Bun!" })
    );

    const response = await fetch(new Request("http://localhost:3005/"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ message: "Hello Bun!" });
    expect(response.headers.get("X-RateLimit-Limit")).toBe("100");
  });
});

describe("bun helpers", () => {
  it("jsonResponse creates JSON response with status", async () => {
    const response = jsonResponse({ error: "nope" }, 400, {
      "X-RateLimit-Limit": "10",
      "X-RateLimit-Remaining": "0",
      "X-RateLimit-Reset": "1710000000",
    });

    expect(response.status).toBe(400);
    expect(response.headers.get("X-RateLimit-Limit")).toBe("10");
    expect(await response.json()).toEqual({ error: "nope" });
  });

  it("applyRateLimitHeaders merges headers into response", () => {
    const original = new Response("ok", { status: 200, headers: { "X-Custom": "1" } });
    const updated = applyRateLimitHeaders(original, {
      "X-RateLimit-Limit": "5",
      "X-RateLimit-Remaining": "4",
      "X-RateLimit-Reset": "1710000000",
    });

    expect(updated.headers.get("X-Custom")).toBe("1");
    expect(updated.headers.get("X-RateLimit-Remaining")).toBe("4");
  });
});