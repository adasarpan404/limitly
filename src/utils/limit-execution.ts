import type { RedisLimit } from "../limiter";
import type {
  ConcurrencyConfig,
  MiddlewareOptions,
  RateLimitResult,
  RateLimitStrategy,
} from "../types";
import { applyRetryAfterJitter } from "./jitter";
import { consumeRateLimit } from "./metrics";

export function isConcurrencyAlgorithm(
  options: MiddlewareOptions
): options is MiddlewareOptions & ConcurrencyConfig {
  return options.algorithm === "concurrency";
}

export type LimitRequestOutcome =
  | { status: "allowed"; result: RateLimitResult; slotId?: string }
  | { status: "blocked"; result: RateLimitResult }
  | { status: "error"; failOpen: boolean; error: unknown };

export async function processLimitRequest(params: {
  limiter: RedisLimit;
  strategy: RateLimitStrategy;
  key: string;
  options: MiddlewareOptions;
  failOpen: boolean;
  context?: unknown;
}): Promise<LimitRequestOutcome> {
  const { limiter, strategy, key, options, failOpen, context } = params;
  const outcome = await consumeRateLimit({
    strategy,
    key,
    options,
    failOpen,
    storeType: limiter.getStoreType(),
    context,
  });

  if (outcome.status === "error") {
    return { status: "error", failOpen, error: outcome.error };
  }

  const result = outcome.result;
  if (!result.allowed) {
    return {
      status: "blocked",
      result: applyRetryAfterJitter(result, options.retryAfterJitter),
    };
  }

  return {
    status: "allowed",
    result,
    slotId: result.slotId,
  };
}

type ReleaseEmitter = {
  on?(event: "finish" | "close", listener: () => void): void;
  addListener?(event: "finish" | "close", listener: () => void): void;
};

export function bindConcurrencyRelease(params: {
  strategy: RateLimitStrategy;
  key: string;
  slotId: string;
  emitter: ReleaseEmitter;
}): void {
  let released = false;

  const release = () => {
    if (released) {
      return;
    }
    released = true;
    void params.strategy.release?.(params.key, params.slotId);
  };

  const attach = params.emitter.on ?? params.emitter.addListener;
  attach?.call(params.emitter, "finish", release);
  attach?.call(params.emitter, "close", release);
}

export async function releaseConcurrencySlot(params: {
  strategy: RateLimitStrategy;
  key: string;
  slotId: string;
}): Promise<void> {
  await params.strategy.release?.(params.key, params.slotId);
}