import { describe, it, expect, afterAll, beforeEach } from "vitest";
import { TokenBucketStrategy } from "../src/algorithms/token-bucket";
import { cleanupRedis, flushTestKeys, getTestRedis } from "./setup";

const TEST_PREFIX = "redislimit:test:tb";

describe("TokenBucketStrategy", () => {
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

  it("allows burst up to capacity", async () => {
    const redis = await redisPromise;
    if (!redis) return;

    const strategy = new TokenBucketStrategy(
      redis,
      { algorithm: "token-bucket", capacity: 5, refillRate: 1 },
      TEST_PREFIX
    );

    for (let i = 0; i < 5; i++) {
      const result = await strategy.consume("burst-user");
      expect(result.allowed).toBe(true);
    }

    const blocked = await strategy.consume("burst-user");
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfter).toBeGreaterThan(0);
  });

  it("refills tokens over time", async () => {
    const redis = await redisPromise;
    if (!redis) return;

    const strategy = new TokenBucketStrategy(
      redis,
      { algorithm: "token-bucket", capacity: 2, refillRate: 10 },
      TEST_PREFIX
    );

    await strategy.consume("refill-user");
    await strategy.consume("refill-user");

    const blocked = await strategy.consume("refill-user");
    expect(blocked.allowed).toBe(false);

    await new Promise((resolve) => setTimeout(resolve, 200));

    const allowed = await strategy.consume("refill-user");
    expect(allowed.allowed).toBe(true);
  });
});