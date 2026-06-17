import type { AlgorithmConfig, RateLimitStrategy } from "../types";
import type { RateLimitStore } from "../stores/types";
import { ConcurrencyStrategy } from "./concurrency";
import { GcraStrategy } from "./gcra";
import { SlidingWindowStrategy } from "./sliding-window";
import { TokenBucketStrategy } from "./token-bucket";

export function createStrategy(
  store: RateLimitStore,
  config: AlgorithmConfig
): RateLimitStrategy {
  switch (config.algorithm) {
    case "sliding-window":
      return new SlidingWindowStrategy(store, config);
    case "token-bucket":
      return new TokenBucketStrategy(store, config);
    case "concurrency":
      return new ConcurrencyStrategy(store, config);
    case "gcra":
      return new GcraStrategy(store, config);
    default: {
      const exhaustive: never = config;
      throw new Error(
        `Unknown algorithm: ${(exhaustive as AlgorithmConfig).algorithm}`
      );
    }
  }
}