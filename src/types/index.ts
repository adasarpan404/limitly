import type { Cluster, Redis, RedisOptions } from "ioredis";

export type RedisClient = Redis | Cluster;

export type RedisConfig =
  | RedisClient
  | string
  | RedisOptions
  | { nodes: { host: string; port: number }[]; options?: RedisOptions };

export interface RedisLimitOptions {
  redis: RedisConfig;
  failOpen?: boolean;
  keyPrefix?: string;
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

export interface BaseMiddlewareOptions {
  key?: (req: unknown) => string | undefined;
  headers?: boolean;
  onLimitReached?: (req: unknown, res: unknown) => void | Promise<void>;
  failOpen?: boolean;
}

export type MiddlewareOptions = BaseMiddlewareOptions & AlgorithmConfig;

export interface RateLimitHeaders {
  "X-RateLimit-Limit": string;
  "X-RateLimit-Remaining": string;
  "X-RateLimit-Reset": string;
  "Retry-After"?: string;
}