import type { Cluster, ClusterOptions, Redis, RedisOptions } from "ioredis";
import type Memcached from "memcached";
import type { RateLimitTracer } from "../observability/types";
import type { StoreType } from "../stores/types";


export type { StoreType };

export type RedisClient = Redis | Cluster;

export type RedisClusterConfig = {
  nodes: { host: string; port: number }[];
  options?: ClusterOptions;
};

export type RedisConfig =
  | RedisClient
  | string
  | RedisOptions
  | RedisClusterConfig;

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
  /**
   * Redis Cluster hash tag for slot pinning. Keys become `{tag}:{prefix}:sw:{id}`.
   * Leave unset to distribute keys across slots (recommended for throughput).
   */
  hashTag?: string;
  /** Preload Lua scripts on all cluster masters at startup. Defaults to `true` for cluster. */
  warmupScripts?: boolean;
  /** Default rate limit config applied when middleware options omit algorithm settings. */
  default?: MiddlewareOptionsInput;
  /** Global metrics hook applied to all rate limit checks. */
  onMetrics?: RateLimitMetricsHook | RateLimitMetricsHook[];
  /** Global tracer for distributed tracing of rate limit checks. */
  tracer?: RateLimitTracer;
}

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  reset: number;
  retryAfter?: number;
  /** Present when a concurrency slot was acquired. */
  slotId?: string;
}

export interface RateLimitStrategy {
  consume(key: string): Promise<RateLimitResult>;
  release?(key: string, slotId: string): Promise<void>;
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

export interface ConcurrencyConfig {
  algorithm: "concurrency";
  /** Maximum in-flight requests per key. */
  limit: number;
  /** Lease TTL in seconds for stale slot cleanup. Defaults to 300. */
  ttl?: number;
}

export interface GcraConfig {
  algorithm: "gcra";
  limit: number;
  window: number;
}

export type AlgorithmConfig =
  | SlidingWindowConfig
  | TokenBucketConfig
  | ConcurrencyConfig
  | GcraConfig;

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
  tracer?: RateLimitTracer;
  failOpen?: boolean;
}

export type MiddlewareOptions = BaseMiddlewareOptions & AlgorithmConfig;

export type MiddlewareOptionsInput = BaseMiddlewareOptions & {
  algorithm?: "sliding-window" | "token-bucket" | "concurrency" | "gcra";
  limit?: number;
  window?: number;
  capacity?: number;
  refillRate?: number;
  ttl?: number;
};

export interface RateLimitHeaders {
  "X-RateLimit-Limit": string;
  "X-RateLimit-Remaining": string;
  "X-RateLimit-Reset": string;
  "Retry-After"?: string;
}