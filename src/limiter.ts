import { createStrategy } from "./algorithms/factory";
import { createExpressMiddleware } from "./middleware/express";
import { createFastifyPlugin } from "./middleware/fastify";
import type { FastifyPluginAsync } from "fastify";
import type {
  AlgorithmConfig,
  MiddlewareOptions,
  RateLimitResult,
  RateLimitStrategy,
  RedisClient,
  RedisLimitOptions,
} from "./types";
import { createRedisClient } from "./utils/redis";

export class RedisLimit {
  private readonly redis: RedisClient;
  private readonly failOpen: boolean;
  private readonly keyPrefix: string;

  constructor(options: RedisLimitOptions) {
    this.redis = createRedisClient(options.redis);
    this.failOpen = options.failOpen ?? true;
    this.keyPrefix = options.keyPrefix ?? "redislimit";
  }

  getRedis(): RedisClient {
    return this.redis;
  }

  createStrategy(config: AlgorithmConfig): RateLimitStrategy {
    return createStrategy(this.redis, config, this.keyPrefix);
  }

  async check(
    key: string,
    config: AlgorithmConfig,
    options?: { failOpen?: boolean }
  ): Promise<RateLimitResult> {
    const strategy = this.createStrategy(config);
    const shouldFailOpen = options?.failOpen ?? this.failOpen;

    try {
      return await strategy.consume(key);
    } catch (error) {
      if (shouldFailOpen) {
        return this.createFailOpenResult(config);
      }
      throw error;
    }
  }

  middleware(options: MiddlewareOptions) {
    return createExpressMiddleware(this)(options);
  }

  get fastifyPlugin(): FastifyPluginAsync<MiddlewareOptions> {
    return createFastifyPlugin(this);
  }

  private createFailOpenResult(config: AlgorithmConfig): RateLimitResult {
    const limit =
      config.algorithm === "sliding-window" ? config.limit : config.capacity;

    return {
      allowed: true,
      limit,
      remaining: limit,
      reset: Math.ceil(Date.now() / 1000) + 60,
    };
  }
}

export function createLimiter(options: RedisLimitOptions): RedisLimit {
  return new RedisLimit(options);
}

export type { MiddlewareOptions };