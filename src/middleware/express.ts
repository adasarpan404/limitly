import type { NextFunction, Request, Response } from "express";
import type { RedisLimit } from "../limiter";
import type { MiddlewareOptions } from "../types";
import { buildRateLimitHeaders, setHeaders } from "../utils/headers";
import { consumeRateLimit } from "../utils/metrics";

const DEFAULT_KEY = (req: Request): string => req.ip ?? "unknown";

export function createExpressMiddleware(limiter: RedisLimit) {
  return function middleware(options: MiddlewareOptions) {
    const strategy = limiter.createStrategy(options);
    const keyExtractor = (options.key ?? DEFAULT_KEY) as (
      req: Request
    ) => string | undefined;
    const sendHeaders = options.headers !== false;
    const failOpen = options.failOpen ?? true;

    return async (
      req: Request,
      res: Response,
      next: NextFunction
    ): Promise<void> => {
      const key = keyExtractor(req) ?? "unknown";
      const outcome = await consumeRateLimit({
        strategy,
        key,
        options,
        failOpen,
        storeType: limiter.getStoreType(),
        context: req,
      });

      if (outcome.status === "error") {
        if (failOpen) {
          return next();
        }
        res.status(503).json({ error: "Service Unavailable" });
        return;
      }

      const result = outcome.result;

      if (sendHeaders) {
        setHeaders(res, buildRateLimitHeaders(result));
      }

      if (result.allowed) {
        next();
        return;
      }

      if (options.onLimitReached) {
        await options.onLimitReached(req, res);
        return;
      }

      res.status(429).json({ error: "Too Many Requests" });
    };
  };
}