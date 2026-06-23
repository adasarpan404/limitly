import type { RateLimitResult } from "../types";

export function applyRetryAfterJitter(
  result: RateLimitResult,
  jitter = 0
): RateLimitResult {
  if (result.allowed || result.retryAfter === undefined || jitter <= 0) {
    return result;
  }

  const maxJitter = jitter;

  const extra = Math.floor(Math.random() * (maxJitter + 1));
  if (extra === 0) {
    return result;
  }

  return {
    ...result,
    retryAfter: result.retryAfter + extra,
  };
}