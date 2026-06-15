import { randomUUID } from "crypto";
import type { RedisClient } from "../types";
import { buildKey } from "../utils/redis";
import { evalScript, parseScriptResult } from "../utils/scripts";
import type { RateLimitStore, StoreType } from "./types";

export class RedisStore implements RateLimitStore {
  readonly type: StoreType;
  private readonly client: RedisClient;
  private readonly keyPrefix: string;

  constructor(
    client: RedisClient,
    keyPrefix: string,
    type: StoreType = "redis"
  ) {
    this.client = client;
    this.keyPrefix = keyPrefix;
    this.type = type;
  }

  getClient(): RedisClient {
    return this.client;
  }

  async slidingWindow(
    key: string,
    limit: number,
    window: number
  ): Promise<import("../types").RateLimitResult> {
    const redisKey = buildKey(this.keyPrefix, `sw:${key}`);
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
    const redisKey = buildKey(this.keyPrefix, `tb:${key}`);
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
}