import type {
  ConcurrencyConfig,
  RateLimitResult,
  RateLimitStrategy,
} from "../types";
import type { RateLimitStore } from "../stores/types";
import { DEFAULT_CONCURRENCY } from "../utils/defaults";

export class ConcurrencyStrategy implements RateLimitStrategy {
  private readonly store: RateLimitStore;
  private readonly limit: number;
  private readonly ttl: number;

  constructor(store: RateLimitStore, config: ConcurrencyConfig) {
    this.store = store;
    this.limit = config.limit;
    this.ttl = config.ttl ?? DEFAULT_CONCURRENCY.ttl!;
  }

  async consume(key: string): Promise<RateLimitResult> {
    return this.store.concurrencyAcquire(key, this.limit, this.ttl);
  }

  async release(key: string, slotId: string): Promise<void> {
    await this.store.concurrencyRelease(key, slotId);
  }
}