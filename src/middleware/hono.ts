import type { Context, Next } from "hono";
import type { RedisLimit } from "../limiter";
import type { MiddlewareOptions } from "../types";
import { buildRateLimitHeaders } from "../utils/headers";
import {
  processLimitRequest,
  releaseConcurrencySlot,
} from "../utils/limit-execution";

const DEFAULT_KEY = (c: Context): string => {
  const forwarded = c.req.header("x-forwarded-for");
  if (forwarded) {
    return forwarded.split(",")[0].trim();
  }
  return c.req.header("x-real-ip") ?? "unknown";
};

function setHonoHeaders(
  c: Context,
  headers: ReturnType<typeof buildRateLimitHeaders>
): void {
  for (const [name, value] of Object.entries(headers)) {
    if (value !== undefined) {
      c.header(name, value);
    }
  }
}

export function createHonoMiddleware(limiter: RedisLimit) {
  return function middleware(options: MiddlewareOptions) {
    const strategy = limiter.createStrategy(options);
    const keyExtractor = (options.key ?? DEFAULT_KEY) as (
      c: Context
    ) => string | undefined;
    const sendHeaders = options.headers !== false;
    const failOpen = options.failOpen ?? true;

    return async (c: Context, next: Next): Promise<Response | void> => {
      const key = keyExtractor(c) ?? "unknown";
      const outcome = await processLimitRequest({
        limiter,
        strategy,
        key,
        options,
        failOpen,
        context: c,
      });

      if (outcome.status === "error") {
        if (failOpen) {
          return next();
        }
        return c.json({ error: "Service Unavailable" }, 503);
      }

      if (outcome.status === "blocked") {
        if (sendHeaders) {
          setHonoHeaders(c, buildRateLimitHeaders(outcome.result));
        }

        if (options.onLimitReached) {
          await options.onLimitReached(c.req.raw, c);
          return;
        }

        return c.json({ error: "Too Many Requests" }, 429);
      }

      if (sendHeaders) {
        setHonoHeaders(c, buildRateLimitHeaders(outcome.result));
      }

      if (outcome.slotId) {
        try {
          return await next();
        } finally {
          await releaseConcurrencySlot({
            strategy,
            key,
            slotId: outcome.slotId,
          });
        }
      }

      return next();
    };
  };
}