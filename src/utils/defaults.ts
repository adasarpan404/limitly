import type {
  AlgorithmConfig,
  BaseMiddlewareOptions,
  MiddlewareOptions,
  MiddlewareOptionsInput,
  SlidingWindowConfig,
  TokenBucketConfig,
} from "../types";

export const DEFAULT_SLIDING_WINDOW: SlidingWindowConfig = {
  algorithm: "sliding-window",
  limit: 100,
  window: 60,
};

export const DEFAULT_TOKEN_BUCKET: TokenBucketConfig = {
  algorithm: "token-bucket",
  capacity: 100,
  refillRate: 10,
};

function pickBaseOptions(
  options: MiddlewareOptionsInput
): BaseMiddlewareOptions {
  return {
    key: options.key,
    headers: options.headers,
    onLimitReached: options.onLimitReached,
    onMetrics: options.onMetrics,
    failOpen: options.failOpen,
  };
}

export function resolveMiddlewareOptions(
  options: MiddlewareOptionsInput = {},
  defaults: MiddlewareOptionsInput = {}
): MiddlewareOptions {
  const merged: MiddlewareOptionsInput = { ...defaults, ...options };
  const base = pickBaseOptions(merged);
  const algorithm = merged.algorithm ?? DEFAULT_SLIDING_WINDOW.algorithm;

  if (algorithm === "token-bucket") {
    return {
      ...base,
      algorithm: "token-bucket",
      capacity: merged.capacity ?? DEFAULT_TOKEN_BUCKET.capacity,
      refillRate: merged.refillRate ?? DEFAULT_TOKEN_BUCKET.refillRate,
    };
  }

  return {
    ...base,
    algorithm: "sliding-window",
    limit: merged.limit ?? DEFAULT_SLIDING_WINDOW.limit,
    window: merged.window ?? DEFAULT_SLIDING_WINDOW.window,
  };
}

export function resolveAlgorithmConfig(
  options: MiddlewareOptionsInput = {},
  defaults: MiddlewareOptionsInput = {}
): AlgorithmConfig {
  const resolved = resolveMiddlewareOptions(options, defaults);
  if (resolved.algorithm === "token-bucket") {
    return {
      algorithm: "token-bucket",
      capacity: resolved.capacity,
      refillRate: resolved.refillRate,
    };
  }

  return {
    algorithm: "sliding-window",
    limit: resolved.limit,
    window: resolved.window,
  };
}