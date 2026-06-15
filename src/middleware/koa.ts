import type { Context, Next } from "koa";
import type { RedisLimit } from "../limiter";
import type { MiddlewareOptions } from "../types";
import { buildRateLimitHeaders } from "../utils/headers";
import { consumeRateLimit } from "../utils/metrics";

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
      const outcome = await consumeRateLimit({
        strategy,
        key,
        options,
        failOpen,
        storeType: limiter.getStoreType(),
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

      const result = outcome.result;

      if (sendHeaders) {
        setKoaHeaders(ctx, buildRateLimitHeaders(result));
      }

      if (result.allowed) {
        return next();
      }

      if (options.onLimitReached) {
        await options.onLimitReached(ctx.request, ctx.response);
        return;
      }

      ctx.status = 429;
      ctx.body = { error: "Too Many Requests" };
    };
  };
}