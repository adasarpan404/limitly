import type {
  RateLimitResult,
  RateLimitStrategy,
  TokenBucketConfig,
} from "../types";
import type { RateLimitStore } from "../stores/types";

export class TokenBucketStrategy implements RateLimitStrategy {
  private readonly store: RateLimitStore;
  private readonly capacity: number;
  private readonly refillRate: number;

  constructor(store: RateLimitStore, config: TokenBucketConfig) {
    this.store = store;
    this.capacity = config.capacity;
    this.refillRate = config.refillRate;
  }

  async consume(key: string): Promise<RateLimitResult> {
    return this.store.tokenBucket(key, this.capacity, this.refillRate);
  }
}