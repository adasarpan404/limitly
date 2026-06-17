import { describe, it, expect, vi } from "vitest";
import { consumeRateLimit } from "../src/utils/metrics";
import type { MiddlewareOptions, RateLimitStrategy } from "../src/types";

const baseOptions: MiddlewareOptions = {
  algorithm: "sliding-window",
  limit: 100,
  window: 60,
};

function createStrategy(
  consume: ReturnType<typeof vi.fn>
): RateLimitStrategy {
  return { consume };
}

describe("consumeRateLimit", () => {
  it("emits allowed metrics event", async () => {
    const onMetrics = vi.fn();
    const consume = vi.fn().mockResolvedValue({
      allowed: true,
      limit: 100,
      remaining: 99,
      reset: 1710000000,
    });

    const outcome = await consumeRateLimit({
      strategy: createStrategy(consume),
      key: "user-1",
      options: { ...baseOptions, onMetrics },
      failOpen: true,
      storeType: "redis",
      context: { id: "req-1" },
    });

    expect(outcome.status).toBe("allowed");
    expect(onMetrics).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "allowed",
        key: "user-1",
        algorithm: "sliding-window",
        store: "redis",
        context: { id: "req-1" },
        durationMs: expect.any(Number),
      })
    );
  });

  it("emits blocked metrics event", async () => {
    const onMetrics = vi.fn();
    const consume = vi.fn().mockResolvedValue({
      allowed: false,
      limit: 1,
      remaining: 0,
      reset: 1710000060,
      retryAfter: 30,
    });

    const outcome = await consumeRateLimit({
      strategy: createStrategy(consume),
      key: "user-2",
      options: { ...baseOptions, onMetrics },
      failOpen: true,
    });

    expect(outcome.status).toBe("blocked");
    expect(onMetrics).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "blocked",
        key: "user-2",
      })
    );
  });

  it("emits error and fail_open metrics when store fails with failOpen", async () => {
    const onMetrics = vi.fn();
    const consume = vi.fn().mockRejectedValue(new Error("Redis down"));

    const outcome = await consumeRateLimit({
      strategy: createStrategy(consume),
      key: "user-3",
      options: { ...baseOptions, onMetrics },
      failOpen: true,
    });

    expect(outcome.status).toBe("error");
    expect(onMetrics).toHaveBeenCalledWith(
      expect.objectContaining({ type: "error", failOpen: true })
    );
    expect(onMetrics).toHaveBeenCalledWith(
      expect.objectContaining({ type: "fail_open", key: "user-3" })
    );
  });

  it("emits only error metrics when failOpen is false", async () => {
    const onMetrics = vi.fn();
    const consume = vi.fn().mockRejectedValue(new Error("Redis down"));

    await consumeRateLimit({
      strategy: createStrategy(consume),
      key: "user-4",
      options: { ...baseOptions, onMetrics },
      failOpen: false,
    });

    expect(onMetrics).toHaveBeenCalledTimes(1);
    expect(onMetrics).toHaveBeenCalledWith(
      expect.objectContaining({ type: "error", failOpen: false })
    );
  });

  it("creates trace spans when tracer is provided", async () => {
    const span = {
      setAttribute: vi.fn(),
      setStatus: vi.fn(),
      end: vi.fn(),
    };
    const tracer = {
      startSpan: vi.fn().mockReturnValue(span),
    };
    const consume = vi.fn().mockResolvedValue({
      allowed: false,
      limit: 1,
      remaining: 0,
      reset: 1710000060,
    });

    await consumeRateLimit({
      strategy: createStrategy(consume),
      key: "user-trace",
      options: { ...baseOptions, tracer },
      failOpen: true,
      storeType: "redis",
    });

    expect(tracer.startSpan).toHaveBeenCalledWith("limitly.check", {
      "limitly.algorithm": "sliding-window",
      "limitly.store": "redis",
    });
    expect(span.setAttribute).toHaveBeenCalledWith("limitly.outcome", "blocked");
    expect(span.setAttribute).toHaveBeenCalledWith("limitly.limit", 1);
    expect(span.setAttribute).toHaveBeenCalledWith("limitly.remaining", 0);
    expect(span.setAttribute).toHaveBeenCalledWith("limitly.allowed", false);
    expect(span.setStatus).toHaveBeenCalledWith(true);
    expect(span.end).toHaveBeenCalledOnce();
  });

  it("marks trace spans as error when store fails", async () => {
    const span = {
      setAttribute: vi.fn(),
      setStatus: vi.fn(),
      end: vi.fn(),
    };
    const tracer = {
      startSpan: vi.fn().mockReturnValue(span),
    };
    const consume = vi.fn().mockRejectedValue(new Error("Redis down"));

    await consumeRateLimit({
      strategy: createStrategy(consume),
      key: "user-error",
      options: { ...baseOptions, tracer },
      failOpen: true,
    });

    expect(span.setAttribute).toHaveBeenCalledWith("limitly.outcome", "error");
    expect(span.setStatus).toHaveBeenCalledWith(false, "Redis down");
    expect(span.end).toHaveBeenCalledOnce();
  });

  it("supports multiple metrics hooks", async () => {
    const hookA = vi.fn();
    const hookB = vi.fn();
    const consume = vi.fn().mockResolvedValue({
      allowed: true,
      limit: 100,
      remaining: 50,
      reset: 1710000000,
    });

    await consumeRateLimit({
      strategy: createStrategy(consume),
      key: "user-5",
      options: { ...baseOptions, onMetrics: [hookA, hookB] },
      failOpen: true,
    });

    expect(hookA).toHaveBeenCalledOnce();
    expect(hookB).toHaveBeenCalledOnce();
  });
});