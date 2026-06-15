import { describe, it, expect, vi } from "vitest";
import { createStrategy } from "../src/algorithms/factory";
import { SlidingWindowStrategy } from "../src/algorithms/sliding-window";
import { TokenBucketStrategy } from "../src/algorithms/token-bucket";
import type { RateLimitStore } from "../src/stores/types";

function createMockStore(): RateLimitStore {
  return {
    type: "redis",
    slidingWindow: vi.fn(),
    tokenBucket: vi.fn(),
  };
}

describe("createStrategy", () => {
  it("creates SlidingWindowStrategy", () => {
    const store = createMockStore();
    const strategy = createStrategy(store, {
      algorithm: "sliding-window",
      limit: 100,
      window: 60,
    });
    expect(strategy).toBeInstanceOf(SlidingWindowStrategy);
  });

  it("creates TokenBucketStrategy", () => {
    const store = createMockStore();
    const strategy = createStrategy(store, {
      algorithm: "token-bucket",
      capacity: 50,
      refillRate: 10,
    });
    expect(strategy).toBeInstanceOf(TokenBucketStrategy);
  });
});