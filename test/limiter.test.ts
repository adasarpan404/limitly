import { describe, it, expect, afterAll } from "vitest";
import { RedisLimit, createLimiter } from "../src/limiter";
import { cleanupRedis, getTestRedis } from "./setup";

describe("RedisLimit", () => {
  const redisPromise = getTestRedis();

  afterAll(async () => {
    await cleanupRedis();
  });

  it("creates limiter from Redis instance", async () => {
    const redis = await redisPromise;
    if (!redis) return;

    const limiter = createLimiter({ redis });
    expect(limiter.getRedis()).toBe(redis);
    expect(limiter.getStoreType()).toBe("redis");
  });

  it("creates limiter with valkey store", async () => {
    const redis = await redisPromise;
    if (!redis) return;

    const limiter = createLimiter({ store: "valkey", redis });
    expect(limiter.getStoreType()).toBe("valkey");
    expect(limiter.getRedis()).toBeDefined();
  });

  it("creates limiter with dragonfly store", async () => {
    const redis = await redisPromise;
    if (!redis) return;

    const limiter = createLimiter({ store: "dragonfly", redis });
    expect(limiter.getStoreType()).toBe("dragonfly");
  });

  it("creates limiter from connection URL", async () => {
    const redis = await redisPromise;
    if (!redis) return;

    const limiter = new RedisLimit({
      redis: `redis://${process.env.REDIS_HOST ?? "localhost"}:${process.env.REDIS_PORT ?? 6379}`,
    });
    expect(limiter.getRedis()).toBeDefined();
  });

  it("failOpen allows traffic on Redis error", async () => {
    const limiter = new RedisLimit({
      redis: {
        host: "invalid-host",
        port: 59999,
        maxRetriesPerRequest: 1,
        connectTimeout: 500,
        lazyConnect: true,
      },
      failOpen: true,
    });

    const result = await limiter.check("test-key", {
      algorithm: "sliding-window",
      limit: 100,
      window: 60,
    });

    expect(result.allowed).toBe(true);
    expect(result.limit).toBe(100);
  });

  it("failClosed throws on Redis error", async () => {
    const limiter = new RedisLimit({
      redis: {
        host: "invalid-host",
        port: 59999,
        maxRetriesPerRequest: 1,
        connectTimeout: 500,
        lazyConnect: true,
      },
      failOpen: false,
    });

    await expect(
      limiter.check("test-key", {
        algorithm: "sliding-window",
        limit: 100,
        window: 60,
      })
    ).rejects.toThrow();
  });
});