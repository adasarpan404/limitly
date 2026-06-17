import type { RedisLimitOptions } from "../types";
import { createMemcachedClient } from "../utils/memcached";
import { createRedisClient, DEFAULT_KEY_PREFIX } from "../utils/redis";
import { MemcachedStore } from "./memcached-store";
import { RedisStore } from "./redis-store";
import type { RateLimitStore, StoreType } from "./types";

const REDIS_COMPATIBLE_STORES: StoreType[] = ["redis", "valkey", "dragonfly"];

export function resolveStoreType(options: RedisLimitOptions): StoreType {
  if (options.store) {
    return options.store;
  }
  if (options.memcached) {
    return "memcached";
  }
  return "redis";
}

export function createStore(options: RedisLimitOptions): RateLimitStore {
  const storeType = resolveStoreType(options);
  const keyPrefix = options.keyPrefix ?? DEFAULT_KEY_PREFIX;

  if (storeType === "memcached") {
    if (!options.memcached) {
      throw new Error(
        'Memcached configuration is required when store is "memcached"'
      );
    }
    return new MemcachedStore(
      createMemcachedClient(options.memcached),
      keyPrefix
    );
  }

  if (!options.redis) {
    throw new Error(
      `Redis configuration is required when store is "${storeType}"`
    );
  }

  if (!REDIS_COMPATIBLE_STORES.includes(storeType)) {
    throw new Error(`Unsupported store type: ${storeType}`);
  }

  const client = createRedisClient(options.redis);

  return new RedisStore(client, keyPrefix, storeType, {
    hashTag: options.hashTag,
    warmupScripts: options.warmupScripts,
  });
}