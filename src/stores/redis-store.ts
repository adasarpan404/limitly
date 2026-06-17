import { randomUUID } from "crypto";
import type { RedisClient } from "../types";
import { buildKey, isRedisCluster } from "../utils/redis";
import { evalScript, parseScriptResult, warmupRedisScripts } from "../utils/scripts";
import type { RateLimitStore, StoreType } from "./types";

export class RedisStore implements RateLimitStore {
  readonly type: StoreType;
  private readonly client: RedisClient;
  private readonly keyPrefix: string;
  private readonly hashTag?: string;

  constructor(
    client: RedisClient,
    keyPrefix: string,
    type: StoreType = "redis",
    options: { hashTag?: string; warmupScripts?: boolean } = {}
  ) {
    this.client = client;
    this.keyPrefix = keyPrefix;
    this.type = type;
    this.hashTag = options.hashTag;

    const shouldWarmup =
      options.warmupScripts ?? isRedisCluster(client);

    if (shouldWarmup) {
      void warmupRedisScripts(client).catch(() => {
        // Warmup is best-effort; checks still work via defineCommand fallbacks.
      });
    }
  }

  getClient(): RedisClient {
    return this.client;
  }

  async slidingWindow(
    key: string,
    limit: number,
    window: number
  ): Promise<import("../types").RateLimitResult> {
    const redisKey = buildKey(this.keyPrefix, `sw:${key}`, this.hashTag);
    const now = Date.now();
    const requestId = randomUUID();

    const result = await evalScript(this.client, "sliding", [redisKey], [
      limit,
      window,
      now,
      requestId,
    ]);

    const parsed = parseScriptResult(result);

    return {
      allowed: parsed.allowed,
      limit: parsed.limit,
      remaining: parsed.remaining,
      reset: parsed.reset,
      retryAfter: parsed.retryAfter || undefined,
    };
  }

  async tokenBucket(
    key: string,
    capacity: number,
    refillRate: number
  ): Promise<import("../types").RateLimitResult> {
    const redisKey = buildKey(this.keyPrefix, `tb:${key}`, this.hashTag);
    const now = Date.now();

    const result = await evalScript(this.client, "token", [redisKey], [
      capacity,
      refillRate,
      now,
    ]);

    const parsed = parseScriptResult(result);

    return {
      allowed: parsed.allowed,
      limit: parsed.limit,
      remaining: parsed.remaining,
      reset: parsed.reset,
      retryAfter: parsed.retryAfter || undefined,
    };
  }

  async concurrencyAcquire(
    key: string,
    limit: number,
    ttl: number
  ): Promise<import("../types").RateLimitResult> {
    const redisKey = buildKey(this.keyPrefix, `cc:${key}`, this.hashTag);
    const now = Date.now();
    const slotId = randomUUID();

    const result = await evalScript(
      this.client,
      "concurrencyAcquire",
      [redisKey],
      [limit, ttl, slotId, now]
    );

    const parsed = parseScriptResult(result);

    return {
      allowed: parsed.allowed,
      limit: parsed.limit,
      remaining: parsed.remaining,
      reset: parsed.reset,
      retryAfter: parsed.retryAfter || undefined,
      slotId: parsed.slotId,
    };
  }

  async concurrencyRelease(key: string, slotId: string): Promise<void> {
    const redisKey = buildKey(this.keyPrefix, `cc:${key}`, this.hashTag);
    await evalScript(this.client, "concurrencyRelease", [redisKey], [slotId]);
  }

  async gcra(
    key: string,
    limit: number,
    window: number
  ): Promise<import("../types").RateLimitResult> {
    const redisKey = buildKey(this.keyPrefix, `gcra:${key}`, this.hashTag);
    const now = Date.now();

    const result = await evalScript(this.client, "gcra", [redisKey], [
      limit,
      window,
      now,
    ]);

    const parsed = parseScriptResult(result);

    return {
      allowed: parsed.allowed,
      limit: parsed.limit,
      remaining: parsed.remaining,
      reset: parsed.reset,
      retryAfter: parsed.retryAfter || undefined,
    };
  }
}