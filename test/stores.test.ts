import { describe, it, expect, vi } from "vitest";
import { createStore, resolveStoreType } from "../src/stores/factory";
import { MemcachedStore } from "../src/stores/memcached-store";
import { RedisStore } from "../src/stores/redis-store";
import type { MemcachedClient } from "../src/types";

describe("createStore", () => {
  it("resolves redis by default", () => {
    expect(resolveStoreType({ redis: "redis://localhost:6379" })).toBe("redis");
  });

  it("resolves memcached when memcached config is provided", () => {
    expect(
      resolveStoreType({ memcached: "localhost:11211" })
    ).toBe("memcached");
  });

  it("creates RedisStore for valkey", () => {
    const store = createStore({
      store: "valkey",
      redis: "redis://localhost:6379",
    });
    expect(store).toBeInstanceOf(RedisStore);
    expect(store.type).toBe("valkey");
  });

  it("creates RedisStore for dragonfly", () => {
    const store = createStore({
      store: "dragonfly",
      redis: { host: "localhost", port: 6379 },
    });
    expect(store).toBeInstanceOf(RedisStore);
    expect(store.type).toBe("dragonfly");
  });

  it("creates MemcachedStore", () => {
    const client = {
      get: vi.fn(),
      gets: vi.fn(),
      incr: vi.fn(),
      decr: vi.fn(),
      add: vi.fn(),
      cas: vi.fn(),
    } as unknown as MemcachedClient;

    const store = createStore({
      store: "memcached",
      memcached: client,
    });

    expect(store).toBeInstanceOf(MemcachedStore);
    expect(store.type).toBe("memcached");
  });

  it("throws when memcached store has no memcached config", () => {
    expect(() => createStore({ store: "memcached" })).toThrow(
      'Memcached configuration is required'
    );
  });

  it("throws when redis store has no redis config", () => {
    expect(() => createStore({ store: "redis" })).toThrow(
      'Redis configuration is required'
    );
  });

  it("throws when valkey store has no redis config", () => {
    expect(() => createStore({ store: "valkey" })).toThrow(
      'Redis configuration is required'
    );
  });

  it("creates RedisStore with default redis type", () => {
    const store = createStore({ redis: "redis://localhost:6379" });
    expect(store).toBeInstanceOf(RedisStore);
    expect(store.type).toBe("redis");
  });

  it("explicit store type overrides auto-detection", () => {
    expect(
      resolveStoreType({
        store: "dragonfly",
        redis: "redis://localhost",
        memcached: "localhost:11211",
      })
    ).toBe("dragonfly");
  });
});