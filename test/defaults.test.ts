import { describe, it, expect } from "vitest";
import {
  DEFAULT_GCRA,
  DEFAULT_SLIDING_WINDOW,
  DEFAULT_TOKEN_BUCKET,
  resolveAlgorithmConfig,
  resolveMiddlewareOptions,
} from "../src/utils/defaults";

describe("resolveMiddlewareOptions", () => {
  it("uses gcra defaults when no options provided", () => {
    expect(resolveMiddlewareOptions()).toEqual(DEFAULT_GCRA);
  });

  it("merges limiter-level defaults", () => {
    expect(
      resolveMiddlewareOptions(
        { key: (req: { ip: string }) => req.ip },
        { limit: 50, window: 30 }
      )
    ).toEqual({
      algorithm: "gcra",
      limit: 50,
      window: 30,
      key: expect.any(Function),
    });
  });

  it("overrides defaults with explicit options", () => {
    expect(
      resolveMiddlewareOptions({ limit: 10 }, { limit: 50, window: 30 })
    ).toEqual({
      algorithm: "gcra",
      limit: 10,
      window: 30,
    });
  });

  it("resolves sliding-window when algorithm is specified", () => {
    expect(
      resolveMiddlewareOptions({
        algorithm: "sliding-window",
        limit: 20,
        window: 15,
      })
    ).toEqual({
      algorithm: "sliding-window",
      limit: 20,
      window: 15,
    });
  });

  it("resolves token-bucket when algorithm is specified", () => {
    expect(
      resolveMiddlewareOptions({
        algorithm: "token-bucket",
        capacity: 20,
        refillRate: 5,
      })
    ).toEqual({
      algorithm: "token-bucket",
      capacity: 20,
      refillRate: 5,
    });
  });

  it("fills token-bucket defaults for missing capacity/refillRate", () => {
    expect(
      resolveMiddlewareOptions({ algorithm: "token-bucket", capacity: 25 })
    ).toEqual({
      algorithm: "token-bucket",
      capacity: 25,
      refillRate: DEFAULT_TOKEN_BUCKET.refillRate,
    });
  });
});

describe("resolveAlgorithmConfig", () => {
  it("returns gcra config by default", () => {
    expect(
      resolveAlgorithmConfig({
        limit: 25,
        window: 15,
        key: () => "x",
        headers: false,
      })
    ).toEqual({
      algorithm: "gcra",
      limit: 25,
      window: 15,
    });
  });

  it("returns sliding-window when explicitly configured", () => {
    expect(
      resolveAlgorithmConfig({
        algorithm: "sliding-window",
        limit: 25,
        window: 15,
      })
    ).toEqual({
      algorithm: "sliding-window",
      limit: 25,
      window: 15,
    });
  });
});