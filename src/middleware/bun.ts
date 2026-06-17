import type { RedisLimit } from "../limiter";
import type { MiddlewareOptions, RateLimitHeaders } from "../types";
import { buildRateLimitHeaders } from "../utils/headers";
import {
  processLimitRequest,
  releaseConcurrencySlot,
} from "../utils/limit-execution";

export type BunNext = () => Promise<Response>;

export type BunMiddleware = (req: Request, next: BunNext) => Promise<Response>;

const DEFAULT_KEY = (req: Request): string => {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) {
    return forwarded.split(",")[0].trim();
  }
  return req.headers.get("x-real-ip") ?? "unknown";
};

function toHeaderRecord(headers: RateLimitHeaders): Record<string, string> {
  const record: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    if (value !== undefined) {
      record[name] = value;
    }
  }
  return record;
}

export function applyRateLimitHeaders(
  response: Response,
  headers: RateLimitHeaders
): Response {
  const nextHeaders = new Headers(response.headers);
  for (const [name, value] of Object.entries(headers)) {
    if (value !== undefined) {
      nextHeaders.set(name, value);
    }
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: nextHeaders,
  });
}

export function jsonResponse(
  body: unknown,
  status: number,
  headers?: RateLimitHeaders
): Response {
  return Response.json(
    body,
    headers ? { status, headers: toHeaderRecord(headers) } : { status }
  );
}

export function createBunMiddleware(limiter: RedisLimit) {
  return function middleware(options: MiddlewareOptions): BunMiddleware {
    const strategy = limiter.createStrategy(options);
    const keyExtractor = (options.key ?? DEFAULT_KEY) as (
      req: Request
    ) => string | undefined;
    const sendHeaders = options.headers !== false;
    const failOpen = options.failOpen ?? true;

    return async (req: Request, next: BunNext): Promise<Response> => {
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
        return jsonResponse({ error: "Service Unavailable" }, 503);
      }

      if (outcome.status === "blocked") {
        const rateLimitHeaders = buildRateLimitHeaders(outcome.result);

        if (options.onLimitReached) {
          await options.onLimitReached(req, { headers: rateLimitHeaders });
          return new Response(null, {
            status: 429,
            headers: sendHeaders ? toHeaderRecord(rateLimitHeaders) : undefined,
          });
        }

        return jsonResponse(
          { error: "Too Many Requests" },
          429,
          sendHeaders ? rateLimitHeaders : undefined
        );
      }

      const rateLimitHeaders = buildRateLimitHeaders(outcome.result);

      try {
        const response = await next();

        if (sendHeaders) {
          return applyRateLimitHeaders(response, rateLimitHeaders);
        }

        return response;
      } finally {
        if (outcome.slotId) {
          await releaseConcurrencySlot({
            strategy,
            key,
            slotId: outcome.slotId,
          });
        }
      }
    };
  };
}

export function composeBunHandler(
  middlewares: BunMiddleware[],
  handler: (req: Request) => Response | Promise<Response>
): (req: Request) => Promise<Response> {
  return async (req: Request): Promise<Response> => {
    let index = 0;

    const dispatch = async (): Promise<Response> => {
      if (index < middlewares.length) {
        const middleware = middlewares[index++];
        return middleware(req, dispatch);
      }
      return handler(req);
    };

    return dispatch();
  };
}