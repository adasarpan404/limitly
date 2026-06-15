import type {
  RateLimitResult,
  RateLimitStrategy,
  SlidingWindowConfig,
} from "../types";
import type { RateLimitStore } from "../stores/types";

export class SlidingWindowStrategy implements RateLimitStrategy {
  private readonly store: RateLimitStore;
  private readonly limit: number;
  private readonly window: number;

  constructor(store: RateLimitStore, config: SlidingWindowConfig) {
    this.store = store;
    this.limit = config.limit;
    this.window = config.window;
  }

  async consume(key: string): Promise<RateLimitResult> {
    return this.store.slidingWindow(key, this.limit, this.window);
  }
}