import type { RateLimitResult } from "../types";

export type StoreType = "redis" | "valkey" | "dragonfly" | "memcached";

export interface RateLimitStore {
  readonly type: StoreType;
  slidingWindow(
    key: string,
    limit: number,
    window: number
  ): Promise<RateLimitResult>;
  tokenBucket(
    key: string,
    capacity: number,
    refillRate: number
  ): Promise<RateLimitResult>;
  concurrencyAcquire(
    key: string,
    limit: number,
    ttl: number
  ): Promise<RateLimitResult>;
  concurrencyRelease(key: string, slotId: string): Promise<void>;
  gcra(key: string, limit: number, window: number): Promise<RateLimitResult>;
}