import type {
  AlgorithmConfig,
  BaseMiddlewareOptions,
  ConcurrencyConfig,
  GcraConfig,
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

export const DEFAULT_CONCURRENCY: ConcurrencyConfig = {
  algorithm: "concurrency",
  limit: 10,
  ttl: 300,
};

export const DEFAULT_GCRA: GcraConfig = {
  algorithm: "gcra",
  limit: 100,
  window: 60,
};

function pickBaseOptions(
  options: MiddlewareOptionsInput
): BaseMiddlewareOptions {
  return {
    key: options.key,
    headers: options.headers,
    onLimitReached: options.onLimitReached,
    onMetrics: options.onMetrics,
    tracer: options.tracer,
    failOpen: options.failOpen,
    retryAfterJitter: options.retryAfterJitter ?? 0,
  };
}

export function resolveMiddlewareOptions(
  options: MiddlewareOptionsInput = {},
  defaults: MiddlewareOptionsInput = {}
): MiddlewareOptions {
  const merged: MiddlewareOptionsInput = { ...defaults, ...options };
  const base = pickBaseOptions(merged);
  const algorithm = merged.algorithm ?? DEFAULT_GCRA.algorithm;

  if (algorithm === "token-bucket") {
    return {
      ...base,
      algorithm: "token-bucket",
      capacity: merged.capacity ?? DEFAULT_TOKEN_BUCKET.capacity,
      refillRate: merged.refillRate ?? DEFAULT_TOKEN_BUCKET.refillRate,
    };
  }

  if (algorithm === "concurrency") {
    return {
      ...base,
      algorithm: "concurrency",
      limit: merged.limit ?? DEFAULT_CONCURRENCY.limit,
      ttl: merged.ttl ?? DEFAULT_CONCURRENCY.ttl,
    };
  }

  if (algorithm === "gcra") {
    return {
      ...base,
      algorithm: "gcra",
      limit: merged.limit ?? DEFAULT_GCRA.limit,
      window: merged.window ?? DEFAULT_GCRA.window,
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

  if (resolved.algorithm === "concurrency") {
    return {
      algorithm: "concurrency",
      limit: resolved.limit,
      ttl: resolved.ttl ?? DEFAULT_CONCURRENCY.ttl,
    };
  }

  if (resolved.algorithm === "gcra") {
    return {
      algorithm: "gcra",
      limit: resolved.limit,
      window: resolved.window,
    };
  }

  return {
    algorithm: "sliding-window",
    limit: resolved.limit,
    window: resolved.window,
  };
}