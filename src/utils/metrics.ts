import type {
  AlgorithmConfig,
  MiddlewareOptions,
  RateLimitMetricsEvent,
  RateLimitMetricsHook,
  RateLimitResult,
  RateLimitStrategy,
  StoreType,
} from "../types";

export type RateLimitCheckOutcome =
  | { status: "allowed"; result: RateLimitResult }
  | { status: "blocked"; result: RateLimitResult }
  | { status: "error"; error: unknown; failOpen: boolean };

function getAlgorithm(options: MiddlewareOptions): AlgorithmConfig["algorithm"] {
  return options.algorithm;
}

async function emitMetrics(
  hooks: RateLimitMetricsHook | RateLimitMetricsHook[] | undefined,
  event: RateLimitMetricsEvent
): Promise<void> {
  if (!hooks) {
    return;
  }

  const handlers = Array.isArray(hooks) ? hooks : [hooks];
  await Promise.all(handlers.map((hook) => hook(event)));
}

export async function consumeRateLimit(params: {
  strategy: RateLimitStrategy;
  key: string;
  options: MiddlewareOptions;
  failOpen: boolean;
  storeType?: StoreType;
  context?: unknown;
}): Promise<RateLimitCheckOutcome> {
  const { strategy, key, options, failOpen, storeType, context } = params;
  const algorithm = getAlgorithm(options);
  const startedAt = performance.now();

  try {
    const result = await strategy.consume(key);
    const durationMs = performance.now() - startedAt;

    await emitMetrics(options.onMetrics, {
      type: result.allowed ? "allowed" : "blocked",
      key,
      algorithm,
      result,
      durationMs,
      store: storeType,
      context,
    });

    return {
      status: result.allowed ? "allowed" : "blocked",
      result,
    };
  } catch (error) {
    const durationMs = performance.now() - startedAt;

    await emitMetrics(options.onMetrics, {
      type: "error",
      key,
      algorithm,
      error,
      durationMs,
      failOpen,
      store: storeType,
      context,
    });

    if (failOpen) {
      await emitMetrics(options.onMetrics, {
        type: "fail_open",
        key,
        algorithm,
        durationMs,
        store: storeType,
        context,
      });
    }

    return { status: "error", error, failOpen };
  }
}