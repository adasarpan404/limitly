import type { Context, Next } from "hono";
import type { RedisLimit } from "../limiter";
import type { MiddlewareOptions } from "../types";
import { buildRateLimitHeaders } from "../utils/headers";

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

      let result;
      try {
        result = await strategy.consume(key);
      } catch {
        if (failOpen) {
          return next();
        }
        return c.json({ error: "Service Unavailable" }, 503);
      }

      if (sendHeaders) {
        setHonoHeaders(c, buildRateLimitHeaders(result));
      }

      if (result.allowed) {
        return next();
      }

      if (options.onLimitReached) {
        await options.onLimitReached(c.req.raw, c);
        return;
      }

      return c.json({ error: "Too Many Requests" }, 429);
    };
  };
}