import type { RateLimitHeaders, RateLimitResult } from "../types";

export function buildRateLimitHeaders(
  result: RateLimitResult
): RateLimitHeaders {
  const headers: RateLimitHeaders = {
    "X-RateLimit-Limit": String(result.limit),
    "X-RateLimit-Remaining": String(result.remaining),
    "X-RateLimit-Reset": String(result.reset),
  };

  if (!result.allowed && result.retryAfter !== undefined) {
    headers["Retry-After"] = String(result.retryAfter);
  }

  return headers;
}

export function setHeaders(
  res: { setHeader: (name: string, value: string) => void },
  headers: RateLimitHeaders
): void {
  for (const [name, value] of Object.entries(headers)) {
    if (value !== undefined) {
      res.setHeader(name, value);
    }
  }
}