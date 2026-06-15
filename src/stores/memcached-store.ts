import type { RateLimitResult } from "../types";
import type { MemcachedClient } from "../types";
import { buildKey } from "../utils/redis";
import {
  memcachedAdd,
  memcachedCas,
  memcachedGet,
  memcachedGets,
  memcachedIncr,
} from "../utils/memcached";
import type { RateLimitStore } from "./types";

const CAS_RETRIES = 5;

export class MemcachedStore implements RateLimitStore {
  readonly type = "memcached" as const;
  private readonly client: MemcachedClient;
  private readonly keyPrefix: string;

  constructor(client: MemcachedClient, keyPrefix: string) {
    this.client = client;
    this.keyPrefix = keyPrefix;
  }

  getClient(): MemcachedClient {
    return this.client;
  }

  async slidingWindow(
    key: string,
    limit: number,
    window: number
  ): Promise<RateLimitResult> {
    const baseKey = buildKey(this.keyPrefix, `sw:${key}`);
    const now = Date.now();
    const windowMs = window * 1000;
    const currentWindow = Math.floor(now / windowMs);
    const previousWindow = currentWindow - 1;
    const elapsedRatio = (now % windowMs) / windowMs;

    const currentKey = `${baseKey}:${currentWindow}`;
    const previousKey = `${baseKey}:${previousWindow}`;

    await memcachedAdd(this.client, currentKey, "0", window * 2);
    const currentCount = await memcachedIncr(this.client, currentKey, 1);

    const previousRaw = await memcachedGet(this.client, previousKey);
    const previousCount = previousRaw ? Number(previousRaw) : 0;
    const weightedCount =
      previousCount * (1 - elapsedRatio) + currentCount;

    const reset = Math.ceil((now + windowMs) / 1000);

    if (weightedCount <= limit) {
      return {
        allowed: true,
        limit,
        remaining: Math.max(0, Math.floor(limit - weightedCount)),
        reset,
      };
    }

    const retryAfter = Math.max(
      1,
      Math.ceil((1 - elapsedRatio) * window)
    );

    return {
      allowed: false,
      limit,
      remaining: 0,
      reset,
      retryAfter,
    };
  }

  async tokenBucket(
    key: string,
    capacity: number,
    refillRate: number
  ): Promise<RateLimitResult> {
    const cacheKey = buildKey(this.keyPrefix, `tb:${key}`);
    const now = Date.now();
    const ttl = Math.ceil(capacity / refillRate) + 1;

    for (let attempt = 0; attempt < CAS_RETRIES; attempt++) {
      const existing = await memcachedGets(this.client, cacheKey);

      let tokens: number;
      let lastRefill: number;

      if (!existing) {
        tokens = capacity;
        lastRefill = now;
      } else {
        const parsed = JSON.parse(existing.value) as {
          tokens: number;
          lastRefill: number;
        };
        tokens = parsed.tokens;
        lastRefill = parsed.lastRefill;
      }

      const elapsed = (now - lastRefill) / 1000;
      tokens = Math.min(capacity, tokens + elapsed * refillRate);
      lastRefill = now;

      if (tokens < 1) {
        const retryAfter = Math.max(1, Math.ceil((1 - tokens) / refillRate));
        const reset = Math.ceil(now / 1000) + retryAfter;

        if (!existing) {
          await memcachedAdd(
            this.client,
            cacheKey,
            JSON.stringify({ tokens, lastRefill }),
            ttl
          );
        } else {
          await memcachedCas(
            this.client,
            cacheKey,
            JSON.stringify({ tokens, lastRefill }),
            existing.cas,
            ttl
          );
        }

        return {
          allowed: false,
          limit: capacity,
          remaining: 0,
          reset,
          retryAfter,
        };
      }

      tokens -= 1;
      const payload = JSON.stringify({ tokens, lastRefill });

      if (!existing) {
        try {
          await memcachedAdd(this.client, cacheKey, payload, ttl);
          return {
            allowed: true,
            limit: capacity,
            remaining: Math.floor(tokens),
            reset:
              Math.ceil(now / 1000) +
              Math.ceil((capacity - tokens) / refillRate),
          };
        } catch {
          continue;
        }
      }

      const updated = await memcachedCas(
        this.client,
        cacheKey,
        payload,
        existing.cas,
        ttl
      );

      if (updated) {
        return {
          allowed: true,
          limit: capacity,
          remaining: Math.floor(tokens),
          reset:
            Math.ceil(now / 1000) +
            Math.ceil((capacity - tokens) / refillRate),
        };
      }
    }

    throw new Error("Token bucket CAS retries exhausted");
  }
}