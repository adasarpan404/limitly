import type { Context, Next } from "koa";
import type { RedisLimit } from "../limiter";
import type { MiddlewareOptions } from "../types";
import { buildRateLimitHeaders } from "../utils/headers";
import {
  bindConcurrencyRelease,
  processLimitRequest,
  releaseConcurrencySlot,
} from "../utils/limit-execution";

const DEFAULT_KEY = (ctx: Context): string => ctx.ip ?? "unknown";

function setKoaHeaders(
  ctx: Context,
  headers: ReturnType<typeof buildRateLimitHeaders>
): void {
  for (const [name, value] of Object.entries(headers)) {
    if (value !== undefined) {
      ctx.set(name, value);
    }
  }
}

export function createKoaMiddleware(limiter: RedisLimit) {
  return function middleware(options: MiddlewareOptions) {
    const strategy = limiter.createStrategy(options);
    const keyExtractor = (options.key ?? DEFAULT_KEY) as (
      ctx: Context
    ) => string | undefined;
    const sendHeaders = options.headers !== false;
    const failOpen = options.failOpen ?? true;

    return async (ctx: Context, next: Next): Promise<void> => {
      const key = keyExtractor(ctx) ?? "unknown";
      const outcome = await processLimitRequest({
        limiter,
        strategy,
        key,
        options,
        failOpen,
        context: ctx,
      });

      if (outcome.status === "error") {
        if (failOpen) {
          return next();
        }
        ctx.status = 503;
        ctx.body = { error: "Service Unavailable" };
        return;
      }

      if (outcome.status === "blocked") {
        if (sendHeaders) {
          setKoaHeaders(ctx, buildRateLimitHeaders(outcome.result));
        }

        if (options.onLimitReached) {
          await options.onLimitReached(ctx.request, ctx.response);
          return;
        }

        ctx.status = 429;
        ctx.body = { error: "Too Many Requests" };
        return;
      }

      if (sendHeaders) {
        setKoaHeaders(ctx, buildRateLimitHeaders(outcome.result));
      }

      if (outcome.slotId) {
        bindConcurrencyRelease({
          strategy,
          key,
          slotId: outcome.slotId,
          emitter: ctx.res,
        });
      }

      return next();
    };
  };
}