import type { RateLimitSpan } from "../observability/types";
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

function startTraceSpan(
  options: MiddlewareOptions,
  params: {
    algorithm: AlgorithmConfig["algorithm"];
    key: string;
    storeType?: StoreType;
  }
): RateLimitSpan | undefined {
  const tracer = options.tracer;
  if (!tracer) {
    return undefined;
  }

  const attributes: Record<string, string | number | boolean> = {
    "limitly.algorithm": params.algorithm,
  };

  if (params.storeType) {
    attributes["limitly.store"] = params.storeType;
  }

  return tracer.startSpan("limitly.check", attributes);
}

function finishTraceSpan(
  span: RateLimitSpan | undefined,
  params: {
    outcome: RateLimitMetricsEvent["type"];
    result?: RateLimitResult;
    error?: unknown;
  }
): void {
  if (!span) {
    return;
  }

  span.setAttribute("limitly.outcome", params.outcome);

  if (params.result) {
    span.setAttribute("limitly.limit", params.result.limit);
    span.setAttribute("limitly.remaining", params.result.remaining);
    span.setAttribute("limitly.allowed", params.result.allowed);
  }

  if (params.error) {
    const message =
      params.error instanceof Error ? params.error.message : String(params.error);
    span.setStatus(false, message);
  } else if (params.outcome === "error") {
    span.setStatus(false, "rate limit store error");
  } else {
    span.setStatus(true);
  }

  span.end();
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
  const span = startTraceSpan(options, { algorithm, key, storeType });

  try {
    const result = await strategy.consume(key);
    const durationMs = performance.now() - startedAt;
    const outcome = result.allowed ? "allowed" : "blocked";

    finishTraceSpan(span, { outcome, result });

    await emitMetrics(options.onMetrics, {
      type: outcome,
      key,
      algorithm,
      result,
      durationMs,
      store: storeType,
      context,
    });

    return {
      status: outcome,
      result,
    };
  } catch (error) {
    const durationMs = performance.now() - startedAt;

    finishTraceSpan(span, { outcome: "error", error });

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