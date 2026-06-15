import Memcached from "memcached";
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

  it("uses limitly as default keyPrefix", async () => {
    const redis = await redisPromise;
    if (!redis) return;

    const limiter = createLimiter({ redis });
    const strategy = limiter.createStrategy({
      algorithm: "sliding-window",
      limit: 10,
      window: 60,
    });

    await strategy.consume("user-default");
    const keys = await redis.keys("limitly:sw:*");
    expect(keys.some((key) => key.endsWith("user-default"))).toBe(true);
    await redis.del(...keys);
  });

  it("uses custom keyPrefix", async () => {
    const redis = await redisPromise;
    if (!redis) return;

    const limiter = createLimiter({ redis, keyPrefix: "custom" });
    const strategy = limiter.createStrategy({
      algorithm: "sliding-window",
      limit: 10,
      window: 60,
    });

    await strategy.consume("user-1");
    const keys = await redis.keys("custom:*");
    expect(keys.length).toBeGreaterThan(0);
    await redis.del(...keys);
  });

  it("uses default algorithm when check config is omitted", async () => {
    const redis = await redisPromise;
    if (!redis) return;

    const limiter = createLimiter({
      redis,
      keyPrefix: "limitly:test:default-algo",
    });

    const result = await limiter.check("default-algo-user");
    expect(result.allowed).toBe(true);
    expect(result.limit).toBe(100);

    await redis.del("limitly:test:default-algo:sw:default-algo-user");
  });

  it("applies limiter default config to middleware", async () => {
    const redis = await redisPromise;
    if (!redis) return;

    const limiter = createLimiter({
      redis,
      keyPrefix: "limitly:test:middleware-default",
      default: { limit: 3, window: 60 },
    });

    const strategy = limiter.createStrategyFromOptions();
    const first = await strategy.consume("mw-user");
    expect(first.limit).toBe(3);
    await redis.del("limitly:test:middleware-default:sw:mw-user");
  });

  it("check works with token-bucket algorithm", async () => {
    const redis = await redisPromise;
    if (!redis) return;

    const limiter = createLimiter({ redis, keyPrefix: "limitly:test:check" });
    const result = await limiter.check("tb-key", {
      algorithm: "token-bucket",
      capacity: 5,
      refillRate: 1,
    });

    expect(result.allowed).toBe(true);
    expect(result.limit).toBe(5);
    await redis.del("limitly:test:check:tb:tb-key");
  });

  it("getRedis throws when using memcached store", () => {
    const client = { get: () => {}, incr: () => {} } as unknown as Memcached;
    const limiter = createLimiter({ store: "memcached", memcached: client });
    expect(() => limiter.getRedis()).toThrow('getRedis() is not available');
  });

  it("getMemcached returns client for memcached store", () => {
    const client = new Memcached("localhost:11211");
    const limiter = createLimiter({ memcached: client });
    expect(limiter.getMemcached()).toBe(client);
    expect(limiter.getStoreType()).toBe("memcached");
  });

  it("exposes middleware factory methods", async () => {
    const redis = await redisPromise;
    if (!redis) return;

    const limiter = createLimiter({ redis });
    expect(typeof limiter.middleware).toBe("function");
    expect(typeof limiter.honoMiddleware).toBe("function");
    expect(typeof limiter.koaMiddleware).toBe("function");
    expect(typeof limiter.bunMiddleware).toBe("function");
    expect(limiter.fastifyPlugin).toBeDefined();
    expect(typeof limiter.nestGuard).toBe("function");
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