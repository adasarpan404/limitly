import { describe, it, expect, vi } from "vitest";
import { SlidingWindowStrategy } from "../src/algorithms/sliding-window";
import { TokenBucketStrategy } from "../src/algorithms/token-bucket";
import type { RateLimitStore } from "../src/stores/types";

function createMockStore(overrides?: Partial<RateLimitStore>): RateLimitStore {
  return {
    type: "memcached",
    slidingWindow: vi.fn().mockResolvedValue({
      allowed: true,
      limit: 10,
      remaining: 9,
      reset: 1710000000,
    }),
    tokenBucket: vi.fn().mockResolvedValue({
      allowed: true,
      limit: 5,
      remaining: 4,
      reset: 1710000000,
    }),
    ...overrides,
  };
}

describe("algorithm strategies", () => {
  it("SlidingWindowStrategy delegates to store.slidingWindow", async () => {
    const store = createMockStore();
    const strategy = new SlidingWindowStrategy(store, {
      algorithm: "sliding-window",
      limit: 10,
      window: 30,
    });

    await strategy.consume("user-1");

    expect(store.slidingWindow).toHaveBeenCalledWith("user-1", 10, 30);
    expect(store.tokenBucket).not.toHaveBeenCalled();
  });

  it("TokenBucketStrategy delegates to store.tokenBucket", async () => {
    const store = createMockStore();
    const strategy = new TokenBucketStrategy(store, {
      algorithm: "token-bucket",
      capacity: 20,
      refillRate: 5,
    });

    await strategy.consume("user-2");

    expect(store.tokenBucket).toHaveBeenCalledWith("user-2", 20, 5);
    expect(store.slidingWindow).not.toHaveBeenCalled();
  });

  it("SlidingWindowStrategy returns store result unchanged", async () => {
    const expected = {
      allowed: false,
      limit: 3,
      remaining: 0,
      reset: 1710000099,
      retryAfter: 12,
    };
    const store = createMockStore({
      slidingWindow: vi.fn().mockResolvedValue(expected),
    });
    const strategy = new SlidingWindowStrategy(store, {
      algorithm: "sliding-window",
      limit: 3,
      window: 60,
    });

    const result = await strategy.consume("blocked");
    expect(result).toEqual(expected);
  });
});