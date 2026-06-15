import { describe, it, expect, vi } from "vitest";
import { buildRateLimitHeaders, setHeaders } from "../src/utils/headers";

describe("setHeaders", () => {
  it("sets all header values on response", () => {
    const res = { setHeader: vi.fn() };
    setHeaders(res, {
      "X-RateLimit-Limit": "100",
      "X-RateLimit-Remaining": "45",
      "X-RateLimit-Reset": "1710000000",
      "Retry-After": "15",
    });

    expect(res.setHeader).toHaveBeenCalledTimes(4);
    expect(res.setHeader).toHaveBeenCalledWith("Retry-After", "15");
  });
});

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

  it("omits Retry-After when request is allowed", () => {
    const headers = buildRateLimitHeaders({
      allowed: true,
      limit: 100,
      remaining: 1,
      reset: 1710000000,
      retryAfter: 15,
    });

    expect(headers["Retry-After"]).toBeUndefined();
  });

  it("omits Retry-After when blocked but retryAfter is zero", () => {
    const headers = buildRateLimitHeaders({
      allowed: false,
      limit: 100,
      remaining: 0,
      reset: 1710000000,
      retryAfter: 0,
    });

    expect(headers["Retry-After"]).toBe("0");
  });
});