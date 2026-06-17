import { describe, it, expect, vi, afterAll, beforeEach } from "vitest";
import { GcraStrategy } from "../src/algorithms/gcra";
import { createStrategy } from "../src/algorithms/factory";
import { RedisStore } from "../src/stores/redis-store";
import { DEFAULT_GCRA } from "../src/utils/defaults";
import { cleanupRedis, flushTestKeys, getTestRedis } from "./setup";

const TEST_PREFIX = "limitly:test:gcra";

function createMockStore() {
  return {
    type: "redis" as const,
    slidingWindow: vi.fn(),
    tokenBucket: vi.fn(),
    concurrencyAcquire: vi.fn(),
    concurrencyRelease: vi.fn(),
    gcra: vi.fn().mockResolvedValue({
      allowed: true,
      limit: 100,
      remaining: 99,
      reset: 1710000000,
    }),
  };
}

describe("GcraStrategy", () => {
  it("delegates to store.gcra", async () => {
    const store = createMockStore();
    const strategy = new GcraStrategy(store, {
      algorithm: "gcra",
      limit: 50,
      window: 30,
    });

    await strategy.consume("user-1");

    expect(store.gcra).toHaveBeenCalledWith("user-1", 50, 30);
  });
});

describe("createStrategy factory", () => {
  it("creates GcraStrategy", () => {
    const store = createMockStore();
    const strategy = createStrategy(store, {
      algorithm: "gcra",
      limit: 20,
      window: 10,
    });

    expect(strategy).toBeInstanceOf(GcraStrategy);
  });
});

describe("DEFAULT_GCRA", () => {
  it("is the library default algorithm", () => {
    expect(DEFAULT_GCRA).toEqual({
      algorithm: "gcra",
      limit: 100,
      window: 60,
    });
  });
});

describe("RedisStore gcra", () => {
  const redisPromise = getTestRedis();

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

    const store = new RedisStore(redis, TEST_PREFIX, "redis", {
      warmupScripts: false,
    });

    for (let i = 0; i < 3; i++) {
      const result = await store.gcra("user-a", 5, 60);
      expect(result.allowed).toBe(true);
      expect(result.limit).toBe(5);
    }
  });

  it("blocks after burst capacity is exhausted", async () => {
    const redis = await redisPromise;
    if (!redis) return;

    const store = new RedisStore(redis, TEST_PREFIX, "redis", {
      warmupScripts: false,
    });

    // GCRA allows a short burst, then enforces spacing via TAT
    for (let i = 0; i < 3; i++) {
      const allowed = await store.gcra("burst-user", 2, 10);
      expect(allowed.allowed).toBe(true);
    }

    const blocked = await store.gcra("burst-user", 2, 10);
    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
    expect(blocked.retryAfter).toBeGreaterThan(0);
  });

  it("isolates keys", async () => {
    const redis = await redisPromise;
    if (!redis) return;

    const store = new RedisStore(redis, TEST_PREFIX, "redis", {
      warmupScripts: false,
    });

    for (let i = 0; i < 3; i++) {
      await store.gcra("key-a", 2, 10);
    }

    const blockedA = await store.gcra("key-a", 2, 10);
    const allowedB = await store.gcra("key-b", 2, 10);

    expect(blockedA.allowed).toBe(false);
    expect(allowedB.allowed).toBe(true);
  });
});