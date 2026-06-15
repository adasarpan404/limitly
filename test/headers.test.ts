import { describe, it, expect } from "vitest";
import { buildRateLimitHeaders } from "../src/utils/headers";

describe("buildRateLimitHeaders", () => {
  it("builds standard headers for allowed request", () => {
    const headers = buildRateLimitHeaders({
      allowed: true,
      limit: 100,
      remaining: 45,
      reset: 1710000000,
    });

    expect(headers).toEqual({
      "X-RateLimit-Limit": "100",
      "X-RateLimit-Remaining": "45",
      "X-RateLimit-Reset": "1710000000",
    });
  });

  it("includes Retry-After when rate limited", () => {
    const headers = buildRateLimitHeaders({
      allowed: false,
      limit: 100,
      remaining: 0,
      reset: 1710000015,
      retryAfter: 15,
    });

    expect(headers["Retry-After"]).toBe("15");
  });
});