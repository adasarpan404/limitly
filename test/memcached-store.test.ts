import { describe, it, expect, vi, beforeEach } from "vitest";
import { MemcachedStore } from "../src/stores/memcached-store";
import type { MemcachedClient } from "../src/types";

function createMockClient() {
  const storage = new Map<string, { value: string; cas: number }>();
  let casCounter = 1;

  const client = {
    get: vi.fn((key: string, cb: (err: null, data?: Buffer) => void) => {
      const entry = storage.get(key);
      cb(null, entry ? Buffer.from(entry.value) : undefined);
    }),
    gets: vi.fn(
      (
        key: string,
        cb: (
          err: null,
          data?: { value: Buffer; cas: number | string }
        ) => void
      ) => {
        const entry = storage.get(key);
        if (!entry) {
          cb(null, undefined);
          return;
        }
        cb(null, { value: Buffer.from(entry.value), cas: entry.cas });
      }
    ),
    incr: vi.fn(
      (key: string, amount: number, cb: (err: null, data: number) => void) => {
        const entry = storage.get(key);
        const current = entry ? Number(entry.value) : 0;
        const next = current + amount;
        storage.set(key, {
          value: String(next),
          cas: entry?.cas ?? ++casCounter,
        });
        cb(null, next);
      }
    ),
    add: vi.fn(
      (
        key: string,
        value: string,
        _ttl: number,
        cb: (err: NodeJS.ErrnoException | null) => void
      ) => {
        if (storage.has(key)) {
          const err = new Error("exists") as NodeJS.ErrnoException;
          err.code = "EEXIST";
          cb(err);
          return;
        }
        storage.set(key, { value, cas: ++casCounter });
        cb(null);
      }
    ),
    cas: vi.fn(
      (
        key: string,
        value: string,
        cas: string,
        _ttl: number,
        cb: (err: NodeJS.ErrnoException | null) => void
      ) => {
        const entry = storage.get(key);
        if (!entry || String(entry.cas) !== cas) {
          const err = new Error("cas mismatch") as NodeJS.ErrnoException;
          err.code = "EEXIST";
          cb(err);
          return;
        }
        storage.set(key, { value, cas: ++casCounter });
        cb(null);
      }
    ),
    _storage: storage,
  };

  return client as unknown as MemcachedClient & {
    _storage: Map<string, { value: string; cas: number }>;
  };
}

describe("MemcachedStore", () => {
  let store: MemcachedStore;
  let client: ReturnType<typeof createMockClient>;

  beforeEach(() => {
    client = createMockClient();
    store = new MemcachedStore(client, "limitly:test");
  });

  it("allows requests under the sliding window limit", async () => {
    for (let i = 0; i < 5; i++) {
      const result = await store.slidingWindow("user-1", 5, 60);
      expect(result.allowed).toBe(true);
      expect(result.limit).toBe(5);
    }
  });

  it("blocks requests over the sliding window limit", async () => {
    for (let i = 0; i < 5; i++) {
      await store.slidingWindow("user-2", 5, 60);
    }

    const result = await store.slidingWindow("user-2", 5, 60);
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
  });

  it("allows burst up to token bucket capacity", async () => {
    for (let i = 0; i < 3; i++) {
      const result = await store.tokenBucket("burst", 3, 1);
      expect(result.allowed).toBe(true);
    }

    const blocked = await store.tokenBucket("burst", 3, 1);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfter).toBeGreaterThan(0);
  });

  it("returns retryAfter when sliding window is exceeded", async () => {
    for (let i = 0; i < 3; i++) {
      await store.slidingWindow("retry-user", 3, 60);
    }

    const blocked = await store.slidingWindow("retry-user", 3, 60);
    expect(blocked.retryAfter).toBeGreaterThan(0);
    expect(blocked.reset).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  it("isolates token bucket keys", async () => {
    for (let i = 0; i < 2; i++) {
      await store.tokenBucket("tb-a", 2, 1);
    }

    const blockedA = await store.tokenBucket("tb-a", 2, 1);
    const allowedB = await store.tokenBucket("tb-b", 2, 1);

    expect(blockedA.allowed).toBe(false);
    expect(allowedB.allowed).toBe(true);
  });

  it("refills token bucket tokens over time", async () => {
    vi.useFakeTimers();

    for (let i = 0; i < 2; i++) {
      await store.tokenBucket("refill", 2, 10);
    }

    let blocked = await store.tokenBucket("refill", 2, 10);
    expect(blocked.allowed).toBe(false);

    vi.advanceTimersByTime(200);

    const allowed = await store.tokenBucket("refill", 2, 10);
    expect(allowed.allowed).toBe(true);

    vi.useRealTimers();
  });

  it("isolates sliding window keys", async () => {
    for (let i = 0; i < 2; i++) {
      await store.slidingWindow("user-a", 2, 60);
    }

    const blockedA = await store.slidingWindow("user-a", 2, 60);
    const allowedB = await store.slidingWindow("user-b", 2, 60);

    expect(blockedA.allowed).toBe(false);
    expect(allowedB.allowed).toBe(true);
  });
});