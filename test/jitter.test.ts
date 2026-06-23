import { afterEach, describe, expect, it, vi } from "vitest";
import { applyRetryAfterJitter } from "../src/utils/jitter";
import { processLimitRequest } from "../src/utils/limit-execution";
import { createMockLimiter } from "./helpers/mock-limiter";

describe("applyRetryAfterJitter", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const blocked = {
    allowed: false,
    limit: 100,
    remaining: 0,
    reset: 1710000030,
    retryAfter: 30,
  };

  it("returns allowed results unchanged", () => {
    const allowed = {
      allowed: true,
      limit: 100,
      remaining: 45,
      reset: 1710000000,
    };

    expect(applyRetryAfterJitter(allowed, 0)).toBe(allowed);
  });

  it("returns blocked results unchanged when jitter is disabled", () => {
    expect(applyRetryAfterJitter(blocked)).toBe(blocked);
    expect(applyRetryAfterJitter(blocked, 0)).toBe(blocked);
  });

  it("adds no jitter when random is zero", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);

    expect(applyRetryAfterJitter(blocked, 10)).toBe(blocked);
  });

  it("adds up to the configured number of seconds", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5);

    expect(applyRetryAfterJitter(blocked, 10)).toEqual({
      ...blocked,
      retryAfter: 35,
    });
  });

  it("ignores non-positive jitter values", () => {
    expect(applyRetryAfterJitter(blocked, 0)).toBe(blocked);
    expect(applyRetryAfterJitter(blocked, -5)).toBe(blocked);
  });
});

describe("processLimitRequest jitter", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("applies jitter to blocked middleware results", async () => {
    vi.spyOn(Math, "random").mockReturnValue(1);

    const { limiter, consume } = createMockLimiter();
    consume.mockResolvedValue({
      allowed: false,
      limit: 100,
      remaining: 0,
      reset: 1710000030,
      retryAfter: 30,
    });

    const outcome = await processLimitRequest({
      limiter,
      strategy: limiter.createStrategy({ algorithm: "gcra", limit: 1, window: 60 }),
      key: "user:1",
      options: {
        algorithm: "gcra",
        limit: 1,
        window: 60,
        retryAfterJitter: 5,
      },
      failOpen: true,
    });

    expect(outcome.status).toBe("blocked");
    if (outcome.status === "blocked") {
      expect(outcome.result.retryAfter).toBe(36);
    }
  });
});