import type { NextFunction, Request, Response } from "express";
import type { RedisLimit } from "../limiter";
import type { MiddlewareOptions } from "../types";
import { buildRateLimitHeaders, setHeaders } from "../utils/headers";
import {
  bindConcurrencyRelease,
  processLimitRequest,
} from "../utils/limit-execution";

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
      const outcome = await processLimitRequest({
        limiter,
        strategy,
        key,
        options,
        failOpen,
        context: req,
      });

      if (outcome.status === "error") {
        if (failOpen) {
          return next();
        }
        res.status(503).json({ error: "Service Unavailable" });
        return;
      }

      if (outcome.status === "blocked") {
        if (sendHeaders) {
          setHeaders(res, buildRateLimitHeaders(outcome.result));
        }

        if (options.onLimitReached) {
          await options.onLimitReached(req, res);
          return;
        }

        res.status(429).json({ error: "Too Many Requests" });
        return;
      }

      if (sendHeaders) {
        setHeaders(res, buildRateLimitHeaders(outcome.result));
      }

      if (outcome.slotId) {
        bindConcurrencyRelease({
          strategy,
          key,
          slotId: outcome.slotId,
          emitter: res,
        });
      }

      next();
    };
  };
}