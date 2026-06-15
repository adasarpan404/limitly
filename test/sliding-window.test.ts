import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { SlidingWindowStrategy } from "../src/algorithms/sliding-window";
import { RedisStore } from "../src/stores/redis-store";
import { cleanupRedis, flushTestKeys, getTestRedis } from "./setup";

const TEST_PREFIX = "limitly:test:sw";

describe("SlidingWindowStrategy", () => {
  const redisPromise = getTestRedis();

  beforeAll(async () => {
    const redis = await redisPromise;
    if (!redis) {
      console.warn("Redis not available — skipping integration tests");
    }
  });

  afterAll(async () => {
    await cleanupRedis();
  });

  beforeEach(async () => {
    const redis = await redisPromise;
    if (redis) {
      await flushTestKeys(redis, TEST_PREFIX);
    }
  });

  it("allows requests under the limit", async () => {
    const redis = await redisPromise;
    if (!redis) return;

    const store = new RedisStore(redis, TEST_PREFIX);
    const strategy = new SlidingWindowStrategy(store, {
      algorithm: "sliding-window",
      limit: 5,
      window: 60,
    });

    for (let i = 0; i < 5; i++) {
      const result = await strategy.consume("user-1");
      expect(result.allowed).toBe(true);
      expect(result.limit).toBe(5);
      expect(result.remaining).toBe(4 - i);
    }
  });

  it("blocks requests over the limit", async () => {
    const redis = await redisPromise;
    if (!redis) return;

    const store = new RedisStore(redis, TEST_PREFIX);
    const strategy = new SlidingWindowStrategy(store, {
      algorithm: "sliding-window",
      limit: 3,
      window: 60,
    });

    for (let i = 0; i < 3; i++) {
      await strategy.consume("user-2");
    }

    const result = await strategy.consume("user-2");
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
    expect(result.retryAfter).toBeGreaterThan(0);
  });

  it("isolates keys", async () => {
    const redis = await redisPromise;
    if (!redis) return;

    const store = new RedisStore(redis, TEST_PREFIX);
    const strategy = new SlidingWindowStrategy(store, {
      algorithm: "sliding-window",
      limit: 2,
      window: 60,
    });

    await strategy.consume("user-a");
    await strategy.consume("user-a");

    const blockedA = await strategy.consume("user-a");
    const allowedB = await strategy.consume("user-b");

    expect(blockedA.allowed).toBe(false);
    expect(allowedB.allowed).toBe(true);
  });

  it("returns reset timestamp in the future when blocked", async () => {
    const redis = await redisPromise;
    if (!redis) return;

    const store = new RedisStore(redis, TEST_PREFIX);
    const strategy = new SlidingWindowStrategy(store, {
      algorithm: "sliding-window",
      limit: 1,
      window: 60,
    });

    await strategy.consume("reset-user");
    const blocked = await strategy.consume("reset-user");

    expect(blocked.allowed).toBe(false);
    expect(blocked.reset).toBeGreaterThanOrEqual(Math.floor(Date.now() / 1000));
    expect(blocked.retryAfter).toBeGreaterThan(0);
  });
});