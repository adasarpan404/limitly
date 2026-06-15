import type { NextFunction, Request, Response } from "express";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createExpressMiddleware } from "../src/middleware/express";
import { createMockLimiter } from "./helpers/mock-limiter";

function createMockReqRes(overrides?: {
  ip?: string;
  headers?: Record<string, string>;
}) {
  const req = {
    ip: overrides?.ip,
    headers: overrides?.headers ?? {},
  } as Request;

  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    setHeader: vi.fn(),
  } as unknown as Response;

  const next = vi.fn() as NextFunction;

  return { req, res, next };
}

describe("createExpressMiddleware", () => {
  let consume: ReturnType<typeof vi.fn>;
  let limiter: ReturnType<typeof createMockLimiter>["limiter"];

  beforeEach(() => {
    ({ limiter, consume } = createMockLimiter());
  });

  it("allows request under the limit", async () => {
    const middleware = createExpressMiddleware(limiter)({
      algorithm: "sliding-window",
      limit: 100,
      window: 60,
    });

    const { req, res, next } = createMockReqRes();
    await middleware(req, res, next);

    expect(consume).toHaveBeenCalledWith("unknown");
    expect(next).toHaveBeenCalled();
  });

  it("uses req.ip as default key", async () => {
    const middleware = createExpressMiddleware(limiter)({
      algorithm: "sliding-window",
      limit: 100,
      window: 60,
    });

    const { req, res, next } = createMockReqRes({ ip: "10.0.0.1" });
    await middleware(req, res, next);

    expect(consume).toHaveBeenCalledWith("10.0.0.1");
  });

  it("uses custom key extractor", async () => {
    const middleware = createExpressMiddleware(limiter)({
      algorithm: "sliding-window",
      limit: 100,
      window: 60,
      key: (req) => req.headers["x-api-key"] as string,
    });

    const { req, res, next } = createMockReqRes({
      headers: { "x-api-key": "secret-key" },
    });
    await middleware(req, res, next);

    expect(consume).toHaveBeenCalledWith("secret-key");
  });

  it("returns 429 when rate limit is exceeded", async () => {
    consume.mockResolvedValue({
      allowed: false,
      limit: 1,
      remaining: 0,
      reset: 1710000060,
      retryAfter: 30,
    });

    const middleware = createExpressMiddleware(limiter)({
      algorithm: "sliding-window",
      limit: 1,
      window: 60,
    });

    const { req, res, next } = createMockReqRes();
    await middleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.json).toHaveBeenCalledWith({ error: "Too Many Requests" });
    expect(next).not.toHaveBeenCalled();
  });

  it("sets rate limit headers", async () => {
    consume.mockResolvedValue({
      allowed: true,
      limit: 100,
      remaining: 45,
      reset: 1710000000,
    });

    const middleware = createExpressMiddleware(limiter)({
      algorithm: "sliding-window",
      limit: 100,
      window: 60,
    });

    const { req, res, next } = createMockReqRes();
    await middleware(req, res, next);

    expect(res.setHeader).toHaveBeenCalledWith("X-RateLimit-Limit", "100");
    expect(res.setHeader).toHaveBeenCalledWith("X-RateLimit-Remaining", "45");
    expect(res.setHeader).toHaveBeenCalledWith("X-RateLimit-Reset", "1710000000");
  });

  it("skips headers when headers: false", async () => {
    const middleware = createExpressMiddleware(limiter)({
      algorithm: "sliding-window",
      limit: 100,
      window: 60,
      headers: false,
    });

    const { req, res, next } = createMockReqRes();
    await middleware(req, res, next);

    expect(res.setHeader).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalled();
  });

  it("calls onLimitReached instead of default 429", async () => {
    consume.mockResolvedValue({
      allowed: false,
      limit: 1,
      remaining: 0,
      reset: 1710000060,
    });

    const onLimitReached = vi.fn();
    const middleware = createExpressMiddleware(limiter)({
      algorithm: "sliding-window",
      limit: 1,
      window: 60,
      onLimitReached,
    });

    const { req, res, next } = createMockReqRes();
    await middleware(req, res, next);

    expect(onLimitReached).toHaveBeenCalledWith(req, res);
    expect(res.status).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  it("failOpen allows traffic on store error", async () => {
    consume.mockRejectedValue(new Error("store down"));

    const middleware = createExpressMiddleware(limiter)({
      algorithm: "sliding-window",
      limit: 100,
      window: 60,
      failOpen: true,
    });

    const { req, res, next } = createMockReqRes();
    await middleware(req, res, next);

    expect(next).toHaveBeenCalled();
  });

  it("returns 503 when failOpen is false and store fails", async () => {
    consume.mockRejectedValue(new Error("store down"));

    const middleware = createExpressMiddleware(limiter)({
      algorithm: "sliding-window",
      limit: 100,
      window: 60,
      failOpen: false,
    });

    const { req, res, next } = createMockReqRes();
    await middleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith({ error: "Service Unavailable" });
    expect(next).not.toHaveBeenCalled();
  });

  it("calls onMetrics hook when provided", async () => {
    const onMetrics = vi.fn();
    const middleware = createExpressMiddleware(limiter)({
      algorithm: "sliding-window",
      limit: 100,
      window: 60,
      onMetrics,
    });

    const { req, res, next } = createMockReqRes();
    await middleware(req, res, next);

    expect(onMetrics).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "allowed",
        key: "unknown",
      })
    );
  });

  it("works with token-bucket algorithm", async () => {
    const middleware = createExpressMiddleware(limiter)({
      algorithm: "token-bucket",
      capacity: 50,
      refillRate: 10,
    });

    const { req, res, next } = createMockReqRes({ ip: "1.2.3.4" });
    await middleware(req, res, next);

    expect(limiter.createStrategy).toHaveBeenCalledWith({
      algorithm: "token-bucket",
      capacity: 50,
      refillRate: 10,
    });
    expect(consume).toHaveBeenCalledWith("1.2.3.4");
    expect(next).toHaveBeenCalled();
  });
});