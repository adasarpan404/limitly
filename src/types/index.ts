import type { Cluster, Redis, RedisOptions } from "ioredis";
import type Memcached from "memcached";
import type { StoreType } from "../stores/types";


export type { StoreType };

export type RedisClient = Redis | Cluster;

export type RedisConfig =
  | RedisClient
  | string
  | RedisOptions
  | { nodes: { host: string; port: number }[]; options?: RedisOptions };

export type MemcachedClient = Memcached;

export type MemcachedOptions = Memcached.options;

export type MemcachedConfig =
  | MemcachedClient
  | string
  | string[]
  | { servers: string | string[]; options?: MemcachedOptions };

export interface RedisLimitOptions {
  /** Storage backend. Defaults to "redis", or "memcached" when memcached config is provided. */
  store?: StoreType;
  /** Redis-compatible connection (Redis, Valkey, DragonflyDB) */
  redis?: RedisConfig;
  /** Memcached server(s) */
  memcached?: MemcachedConfig;
  failOpen?: boolean;
  /** Storage key prefix. Defaults to "limitly". Keys are stored as `{prefix}:sw:{id}` or `{prefix}:tb:{id}`. */
  keyPrefix?: string;
  /** Default rate limit config applied when middleware options omit algorithm settings. */
  default?: MiddlewareOptionsInput;
  /** Global metrics hook applied to all rate limit checks. */
  onMetrics?: RateLimitMetricsHook | RateLimitMetricsHook[];
}

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  reset: number;
  retryAfter?: number;
}

export interface RateLimitStrategy {
  consume(key: string): Promise<RateLimitResult>;
}

export interface SlidingWindowConfig {
  algorithm: "sliding-window";
  limit: number;
  window: number;
}

export interface TokenBucketConfig {
  algorithm: "token-bucket";
  capacity: number;
  refillRate: number;
}

export type AlgorithmConfig = SlidingWindowConfig | TokenBucketConfig;

export type RateLimitMetricsEvent =
  | {
      type: "allowed";
      key: string;
      algorithm: AlgorithmConfig["algorithm"];
      result: RateLimitResult;
      durationMs: number;
      store?: StoreType;
      context?: unknown;
    }
  | {
      type: "blocked";
      key: string;
      algorithm: AlgorithmConfig["algorithm"];
      result: RateLimitResult;
      durationMs: number;
      store?: StoreType;
      context?: unknown;
    }
  | {
      type: "error";
      key: string;
      algorithm: AlgorithmConfig["algorithm"];
      error: unknown;
      durationMs: number;
      failOpen: boolean;
      store?: StoreType;
      context?: unknown;
    }
  | {
      type: "fail_open";
      key: string;
      algorithm: AlgorithmConfig["algorithm"];
      durationMs: number;
      store?: StoreType;
      context?: unknown;
    };

export type RateLimitMetricsHook = (
  event: RateLimitMetricsEvent
) => void | Promise<void>;

export interface BaseMiddlewareOptions {
  key?: (req: unknown) => string | undefined;
  headers?: boolean;
  onLimitReached?: (req: unknown, res: unknown) => void | Promise<void>;
  onMetrics?: RateLimitMetricsHook | RateLimitMetricsHook[];
  failOpen?: boolean;
}

export type MiddlewareOptions = BaseMiddlewareOptions & AlgorithmConfig;

export type MiddlewareOptionsInput = BaseMiddlewareOptions & {
  algorithm?: "sliding-window" | "token-bucket";
  limit?: number;
  window?: number;
  capacity?: number;
  refillRate?: number;
};

export interface RateLimitHeaders {
  "X-RateLimit-Limit": string;
  "X-RateLimit-Remaining": string;
  "X-RateLimit-Reset": string;
  "Retry-After"?: string;
}