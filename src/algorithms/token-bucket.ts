import type {
  RateLimitResult,
  RateLimitStrategy,
  RedisClient,
  TokenBucketConfig,
} from "../types";
import { buildKey } from "../utils/redis";
import { evalScript, parseScriptResult } from "../utils/scripts";

export class TokenBucketStrategy implements RateLimitStrategy {
  private readonly redis: RedisClient;
  private readonly capacity: number;
  private readonly refillRate: number;
  private readonly keyPrefix: string;

  constructor(
    redis: RedisClient,
    config: TokenBucketConfig,
    keyPrefix = "redislimit"
  ) {
    this.redis = redis;
    this.capacity = config.capacity;
    this.refillRate = config.refillRate;
    this.keyPrefix = keyPrefix;
  }

  async consume(key: string): Promise<RateLimitResult> {
    const redisKey = buildKey(this.keyPrefix, `tb:${key}`);
    const now = Date.now();

    const result = await evalScript(this.redis, "token", [redisKey], [
      this.capacity,
      this.refillRate,
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