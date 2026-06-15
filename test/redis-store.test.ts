import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { RedisStore } from "../src/stores/redis-store";
import { cleanupRedis, flushTestKeys, getTestRedis } from "./setup";

const TEST_PREFIX = "redislimit:test:store";

describe("RedisStore", () => {
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

  it("exposes store type", async () => {
    const redis = await redisPromise;
    if (!redis) return;

    const store = new RedisStore(redis, TEST_PREFIX, "valkey");
    expect(store.type).toBe("valkey");
    expect(store.getClient()).toBe(redis);
  });

  it("slidingWindow blocks and returns retryAfter", async () => {
    const redis = await redisPromise;
    if (!redis) return;

    const store = new RedisStore(redis, TEST_PREFIX);

    for (let i = 0; i < 2; i++) {
      const allowed = await store.slidingWindow("sw-user", 2, 60);
      expect(allowed.allowed).toBe(true);
    }

    const blocked = await store.slidingWindow("sw-user", 2, 60);
    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
    expect(blocked.retryAfter).toBeGreaterThan(0);
    expect(blocked.reset).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  it("tokenBucket returns remaining tokens", async () => {
    const redis = await redisPromise;
    if (!redis) return;

    const store = new RedisStore(redis, TEST_PREFIX);
    const result = await store.tokenBucket("tb-user", 10, 5);

    expect(result.allowed).toBe(true);
    expect(result.limit).toBe(10);
    expect(result.remaining).toBe(9);
  });

  it("tokenBucket isolates keys", async () => {
    const redis = await redisPromise;
    if (!redis) return;

    const store = new RedisStore(redis, TEST_PREFIX);

    for (let i = 0; i < 3; i++) {
      await store.tokenBucket("tb-a", 3, 1);
    }

    const blockedA = await store.tokenBucket("tb-a", 3, 1);
    const allowedB = await store.tokenBucket("tb-b", 3, 1);

    expect(blockedA.allowed).toBe(false);
    expect(allowedB.allowed).toBe(true);
  });
});