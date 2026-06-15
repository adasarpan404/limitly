import { createStrategy } from "./algorithms/factory";
import { createExpressMiddleware } from "./middleware/express";
import { createFastifyPlugin } from "./middleware/fastify";
import { createHonoMiddleware } from "./middleware/hono";
import { createBunMiddleware } from "./middleware/bun";
import { createKoaMiddleware } from "./middleware/koa";
import { createNestGuard } from "./middleware/nest";
import { createStore } from "./stores/factory";
import type { RateLimitStore } from "./stores/types";
import type { RedisStore } from "./stores/redis-store";
import type { MemcachedStore } from "./stores/memcached-store";
import {
  resolveAlgorithmConfig,
  resolveMiddlewareOptions,
} from "./utils/defaults";
import { consumeRateLimit } from "./utils/metrics";
import type { FastifyPluginAsync } from "fastify";
import type { CanActivate, Type } from "@nestjs/common";
import type {
  AlgorithmConfig,
  MemcachedClient,
  MiddlewareOptions,
  MiddlewareOptionsInput,
  RateLimitResult,
  RateLimitStrategy,
  RedisClient,
  RedisLimitOptions,
} from "./types";

export class RedisLimit {
  private readonly store: RateLimitStore;
  private readonly failOpen: boolean;
  private readonly defaultOptions: MiddlewareOptionsInput;

  constructor(options: RedisLimitOptions) {
    this.store = createStore(options);
    this.failOpen = options.failOpen ?? true;
    this.defaultOptions = {
      onMetrics: options.onMetrics,
      ...options.default,
    };
  }

  getStore(): RateLimitStore {
    return this.store;
  }

  getStoreType(): RateLimitStore["type"] {
    return this.store.type;
  }

  getDefaultOptions(): MiddlewareOptionsInput {
    return this.defaultOptions;
  }

  resolveOptions(options: MiddlewareOptionsInput = {}): MiddlewareOptions {
    return resolveMiddlewareOptions(options, this.defaultOptions);
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

  createStrategyFromOptions(
    options: MiddlewareOptionsInput = {}
  ): RateLimitStrategy {
    return createStrategy(
      this.store,
      resolveAlgorithmConfig(options, this.defaultOptions)
    );
  }

  async check(
    key: string,
    config: MiddlewareOptionsInput = {},
    options?: { failOpen?: boolean }
  ): Promise<RateLimitResult> {
    const resolved = this.resolveOptions(config);
    const strategy = this.createStrategy(resolved);
    const shouldFailOpen = options?.failOpen ?? this.failOpen;
    const outcome = await consumeRateLimit({
      strategy,
      key,
      options: resolved,
      failOpen: shouldFailOpen,
      storeType: this.store.type,
    });

    if (outcome.status === "error") {
      if (shouldFailOpen) {
        return this.createFailOpenResult(resolved);
      }
      throw outcome.error;
    }

    return outcome.result;
  }

  middleware(options: MiddlewareOptionsInput = {}) {
    return createExpressMiddleware(this)(this.resolveOptions(options));
  }

  honoMiddleware(options: MiddlewareOptionsInput = {}) {
    return createHonoMiddleware(this)(this.resolveOptions(options));
  }

  koaMiddleware(options: MiddlewareOptionsInput = {}) {
    return createKoaMiddleware(this)(this.resolveOptions(options));
  }

  bunMiddleware(options: MiddlewareOptionsInput = {}) {
    return createBunMiddleware(this)(this.resolveOptions(options));
  }

  get fastifyPlugin(): FastifyPluginAsync<MiddlewareOptionsInput> {
    return createFastifyPlugin(this);
  }

  nestGuard(defaultOptions: MiddlewareOptionsInput = {}): Type<CanActivate> {
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

export type { MiddlewareOptions, MiddlewareOptionsInput };