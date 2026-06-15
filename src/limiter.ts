import { createStrategy } from "./algorithms/factory";
import { createExpressMiddleware } from "./middleware/express";
import { createFastifyPlugin } from "./middleware/fastify";
import { createHonoMiddleware } from "./middleware/hono";
import { createKoaMiddleware } from "./middleware/koa";
import { createNestGuard } from "./middleware/nest";
import { createStore } from "./stores/factory";
import type { RateLimitStore } from "./stores/types";
import type { RedisStore } from "./stores/redis-store";
import type { MemcachedStore } from "./stores/memcached-store";
import type { FastifyPluginAsync } from "fastify";
import type { CanActivate, Type } from "@nestjs/common";
import type {
  AlgorithmConfig,
  MemcachedClient,
  MiddlewareOptions,
  RateLimitResult,
  RateLimitStrategy,
  RedisClient,
  RedisLimitOptions,
} from "./types";

export class RedisLimit {
  private readonly store: RateLimitStore;
  private readonly failOpen: boolean;

  constructor(options: RedisLimitOptions) {
    this.store = createStore(options);
    this.failOpen = options.failOpen ?? true;
  }

  getStore(): RateLimitStore {
    return this.store;
  }

  getStoreType(): RateLimitStore["type"] {
    return this.store.type;
  }

  getRedis(): RedisClient {
    if (this.store.type === "memcached") {
      throw new Error(
        `getRedis() is not available when using the "${this.store.type}" store`
      );
    }
    return (this.store as RedisStore).getClient();
  }

  getMemcached(): MemcachedClient {
    if (this.store.type !== "memcached") {
      throw new Error(
        `getMemcached() is only available when using the "memcached" store`
      );
    }
    return (this.store as MemcachedStore).getClient();
  }

  createStrategy(config: AlgorithmConfig): RateLimitStrategy {
    return createStrategy(this.store, config);
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

  honoMiddleware(options: MiddlewareOptions) {
    return createHonoMiddleware(this)(options);
  }

  koaMiddleware(options: MiddlewareOptions) {
    return createKoaMiddleware(this)(options);
  }

  get fastifyPlugin(): FastifyPluginAsync<MiddlewareOptions> {
    return createFastifyPlugin(this);
  }

  nestGuard(defaultOptions?: MiddlewareOptions): Type<CanActivate> {
    return createNestGuard(this)(defaultOptions);
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