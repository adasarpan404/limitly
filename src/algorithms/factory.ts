import type {
  AlgorithmConfig,
  RateLimitStrategy,
  RedisClient,
} from "../types";
import { SlidingWindowStrategy } from "./sliding-window";
import { TokenBucketStrategy } from "./token-bucket";

export function createStrategy(
  redis: RedisClient,
  config: AlgorithmConfig,
  keyPrefix?: string
): RateLimitStrategy {
  switch (config.algorithm) {
    case "sliding-window":
      return new SlidingWindowStrategy(redis, config, keyPrefix);
    case "token-bucket":
      return new TokenBucketStrategy(redis, config, keyPrefix);
    default: {
      const exhaustive: never = config;
      throw new Error(
        `Unknown algorithm: ${(exhaustive as AlgorithmConfig).algorithm}`
      );
    }
  }
}