import { describe, it, expect, vi, afterAll, beforeEach } from "vitest";
import { ConcurrencyStrategy } from "../src/algorithms/concurrency";
import { createStrategy } from "../src/algorithms/factory";
import { RedisLimit, createLimiter } from "../src/limiter";
import { RedisStore } from "../src/stores/redis-store";
import { DEFAULT_CONCURRENCY } from "../src/utils/defaults";
import {
  bindConcurrencyRelease,
  isConcurrencyAlgorithm,
} from "../src/utils/limit-execution";
import { cleanupRedis, flushTestKeys, getTestRedis } from "./setup";

const TEST_PREFIX = "limitly:test:cc";

function createMockStore() {
  return {
    type: "redis" as const,
    slidingWindow: vi.fn(),
    tokenBucket: vi.fn(),
    concurrencyAcquire: vi.fn().mockResolvedValue({
      allowed: true,
      limit: 5,
      remaining: 4,
      reset: 1710000000,
      slotId: "slot-1",
    }),
    concurrencyRelease: vi.fn().mockResolvedValue(undefined),
  };
}

describe("ConcurrencyStrategy", () => {
  it("acquires and releases via store", async () => {
    const store = createMockStore();
    const strategy = new ConcurrencyStrategy(store, {
      algorithm: "concurrency",
      limit: 5,
      ttl: 60,
    });

    const result = await strategy.consume("worker-1");
    expect(store.concurrencyAcquire).toHaveBeenCalledWith("worker-1", 5, 60);
    expect(result.slotId).toBe("slot-1");

    await strategy.release("worker-1", "slot-1");
    expect(store.concurrencyRelease).toHaveBeenCalledWith("worker-1", "slot-1");
  });
});

describe("createStrategy factory", () => {
  it("creates concurrency strategy", () => {
    const store = createMockStore();
    const strategy = createStrategy(store, {
      algorithm: "concurrency",
      limit: 3,
      ttl: 120,
    });

    expect(strategy).toBeInstanceOf(ConcurrencyStrategy);
    expect(strategy.release).toBeTypeOf("function");
  });
});

describe("DEFAULT_CONCURRENCY", () => {
  it("has sensible defaults", () => {
    expect(DEFAULT_CONCURRENCY).toEqual({
      algorithm: "concurrency",
      limit: 10,
      ttl: 300,
    });
  });
});

describe("limit execution helpers", () => {
  it("detects concurrency algorithm", () => {
    expect(
      isConcurrencyAlgorithm({
        algorithm: "concurrency",
        limit: 5,
        ttl: 60,
      })
    ).toBe(true);
    expect(
      isConcurrencyAlgorithm({
        algorithm: "sliding-window",
        limit: 5,
        window: 60,
      })
    ).toBe(false);
  });

  it("binds release to response finish/close once", async () => {
    const release = vi.fn().mockResolvedValue(undefined);
    const strategy = { consume: vi.fn(), release };
    const listeners = new Map<string, Array<() => void>>();
    const emitter = {
      on(event: string, handler: () => void) {
        const current = listeners.get(event) ?? [];
        current.push(handler);
        listeners.set(event, current);
      },
    };

    bindConcurrencyRelease({
      strategy,
      key: "user-1",
      slotId: "slot-abc",
      emitter,
    });

    listeners.get("finish")?.[0]();
    listeners.get("close")?.[0]();

    expect(release).toHaveBeenCalledOnce();
    expect(release).toHaveBeenCalledWith("user-1", "slot-abc");
  });
});

describe("RedisStore concurrency", () => {
  const redisPromise = getTestRedis();

  beforeEach(async () => {
    const redis = await redisPromise;
    if (redis) {
      await flushTestKeys(redis, TEST_PREFIX);
    }
  });

  it("blocks when concurrency limit is reached", async () => {
    const redis = await redisPromise;
    if (!redis) return;

    const store = new RedisStore(redis, TEST_PREFIX, "redis", {
      warmupScripts: false,
    });

    const slots: string[] = [];

    for (let i = 0; i < 2; i++) {
      const acquired = await store.concurrencyAcquire("api", 2, 60);
      expect(acquired.allowed).toBe(true);
      expect(acquired.slotId).toBeDefined();
      slots.push(acquired.slotId!);
    }

    const blocked = await store.concurrencyAcquire("api", 2, 60);
    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);

    await store.concurrencyRelease("api", slots[0]!);

    const acquiredAfterRelease = await store.concurrencyAcquire("api", 2, 60);
    expect(acquiredAfterRelease.allowed).toBe(true);
  });
});

describe("RedisLimit release", () => {
  const redisPromise = getTestRedis();

  beforeEach(async () => {
    const redis = await redisPromise;
    if (redis) {
      await flushTestKeys(redis, TEST_PREFIX);
    }
  });

  it("releases concurrency slots via limiter.release", async () => {
    const redis = await redisPromise;
    if (!redis) return;

    const limiter = createLimiter({
      redis,
      keyPrefix: TEST_PREFIX,
      warmupScripts: false,
    });
    const acquired = await limiter.acquire("job", {
      algorithm: "concurrency",
      limit: 1,
      ttl: 60,
    });

    expect(acquired.allowed).toBe(true);
    expect(acquired.slotId).toBeDefined();

    const blocked = await limiter.acquire("job", {
      algorithm: "concurrency",
      limit: 1,
      ttl: 60,
    });
    expect(blocked.allowed).toBe(false);

    await limiter.release("job", acquired.slotId!, {
      algorithm: "concurrency",
      limit: 1,
      ttl: 60,
    });

    const acquiredAgain = await limiter.acquire("job", {
      algorithm: "concurrency",
      limit: 1,
      ttl: 60,
    });
    expect(acquiredAgain.allowed).toBe(true);
  });

  it("throws when release is used without concurrency algorithm", async () => {
    const redis = await redisPromise;
    if (!redis) return;

    const limiter = new RedisLimit({ redis, keyPrefix: TEST_PREFIX });

    await expect(
      limiter.release("job", "slot-1", {
        algorithm: "sliding-window",
        limit: 10,
        window: 60,
      })
    ).rejects.toThrow('release() requires algorithm: "concurrency"');
  });
});