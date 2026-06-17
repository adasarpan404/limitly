import type { GcraConfig, RateLimitResult, RateLimitStrategy } from "../types";
import type { RateLimitStore } from "../stores/types";

export class GcraStrategy implements RateLimitStrategy {
  private readonly store: RateLimitStore;
  private readonly limit: number;
  private readonly window: number;

  constructor(store: RateLimitStore, config: GcraConfig) {
    this.store = store;
    this.limit = config.limit;
    this.window = config.window;
  }

  async consume(key: string): Promise<RateLimitResult> {
    return this.store.gcra(key, this.limit, this.window);
  }
}