import { randomUUID } from "crypto";
import type {
  RateLimitResult,
  RateLimitStrategy,
  RedisClient,
  SlidingWindowConfig,
} from "../types";
import { buildKey } from "../utils/redis";
import { evalScript, parseScriptResult } from "../utils/scripts";

export class SlidingWindowStrategy implements RateLimitStrategy {
  private readonly redis: RedisClient;
  private readonly limit: number;
  private readonly window: number;
  private readonly keyPrefix: string;

  constructor(
    redis: RedisClient,
    config: SlidingWindowConfig,
    keyPrefix = "redislimit"
  ) {
    this.redis = redis;
    this.limit = config.limit;
    this.window = config.window;
    this.keyPrefix = keyPrefix;
  }

  async consume(key: string): Promise<RateLimitResult> {
    const redisKey = buildKey(this.keyPrefix, `sw:${key}`);
    const now = Date.now();
    const requestId = randomUUID();

    const result = await evalScript(this.redis, "sliding", [redisKey], [
      this.limit,
      this.window,
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
}