import Redis from "ioredis";
import { describe, it, expect } from "vitest";
import { resolveStoreType } from "../src/stores/factory";
import {
  buildKey,
  createRedisClient,
  DEFAULT_KEY_PREFIX,
} from "../src/utils/redis";

describe("buildKey", () => {
  it("joins prefix and key", () => {
    expect(buildKey("limitly", "user:123")).toBe("limitly:user:123");
  });

  it("uses limitly as the default key prefix constant", () => {
    expect(DEFAULT_KEY_PREFIX).toBe("limitly");
    expect(buildKey(DEFAULT_KEY_PREFIX, "sw:api-key-1")).toBe(
      "limitly:sw:api-key-1"
    );
  });
});

describe("createRedisClient", () => {
  it("returns existing Redis instance", () => {
    const redis = new Redis({ lazyConnect: true });
    expect(createRedisClient(redis)).toBe(redis);
  });

  it("creates client from connection URL", () => {
    const client = createRedisClient("redis://localhost:6379");
    expect(client).toBeInstanceOf(Redis);
  });

  it("creates client from options object", () => {
    const client = createRedisClient({ host: "localhost", port: 6379, lazyConnect: true });
    expect(client).toBeInstanceOf(Redis);
  });
});

describe("resolveStoreType", () => {
  it("respects explicit store over memcached config", () => {
    expect(
      resolveStoreType({
        store: "valkey",
        redis: "redis://localhost",
        memcached: "localhost:11211",
      })
    ).toBe("valkey");
  });

  it("defaults to redis when only redis config is provided", () => {
    expect(resolveStoreType({ redis: "redis://localhost" })).toBe("redis");
  });
});