import { describe, it, expect } from "vitest";
import { parseScriptResult } from "../src/utils/scripts";

describe("parseScriptResult", () => {
  it("parses allowed result", () => {
    expect(parseScriptResult([1, 100, 45, 1710000000, 0])).toEqual({
      allowed: true,
      limit: 100,
      remaining: 45,
      reset: 1710000000,
      retryAfter: 0,
    });
  });

  it("parses blocked result with retryAfter", () => {
    expect(parseScriptResult([0, 10, 0, 1710000030, 15])).toEqual({
      allowed: false,
      limit: 10,
      remaining: 0,
      reset: 1710000030,
      retryAfter: 15,
    });
  });

  it("treats non-1 first value as blocked", () => {
    expect(parseScriptResult([2, 5, 0, 1710000000, 5]).allowed).toBe(false);
  });

  it("coerces string values from redis", () => {
    const result = parseScriptResult(["1", "50", "49", "1710000000", "0"]);
    expect(result.allowed).toBe(true);
    expect(result.limit).toBe(50);
    expect(result.remaining).toBe(49);
  });
});