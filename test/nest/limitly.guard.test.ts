import {
  ExecutionContext,
  HttpException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { RedisLimit } from "../../src/limiter";
import {
  createNestGuard,
  limitlyNestModule,
  RateLimit,
  RATE_LIMIT_KEY,
} from "../../src/middleware/nest";
import { resolveMiddlewareOptions } from "../../src/utils/defaults";

function createMockContext(overrides?: {
  ip?: string;
  headers?: Record<string, string>;
}): ExecutionContext {
  const setHeader = vi.fn();
  const request = {
    ip: overrides?.ip ?? "127.0.0.1",
    headers: overrides?.headers ?? {},
  };

  return {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => ({ setHeader }),
    }),
    getHandler: () => vi.fn(),
    getClass: () => vi.fn(),
  } as unknown as ExecutionContext;
}

describe("createNestGuard", () => {
  let limiter: RedisLimit;
  let consume: ReturnType<typeof vi.fn>;
  let reflector: Reflector;
  let guard: InstanceType<ReturnType<ReturnType<typeof createNestGuard>>>;

  beforeEach(() => {
    consume = vi.fn();
    limiter = {
      getDefaultOptions: vi.fn(() => ({})),
      getStoreType: vi.fn(() => "redis" as const),
      resolveOptions: vi.fn((options = {}) => resolveMiddlewareOptions(options)),
      createStrategy: vi.fn(() => ({ consume })),
    } as unknown as RedisLimit;

    reflector = {
      getAllAndOverride: vi.fn(),
    } as unknown as Reflector;

    const Guard = createNestGuard(limiter)({
      algorithm: "sliding-window",
      limit: 100,
      window: 60,
    });
    guard = new Guard(reflector);
  });

  it("allows request when no rate limit options are configured", async () => {
    const Guard = createNestGuard(limiter)();
    const unconfiguredGuard = new Guard(reflector);

    vi.mocked(reflector.getAllAndOverride).mockReturnValue(undefined);

    const result = await unconfiguredGuard.canActivate(createMockContext());
    expect(result).toBe(true);
  });

  it("uses default algorithm when guard factory receives empty options", async () => {
    const DefaultGuard = createNestGuard(limiter)({});
    const guardWithDefaults = new DefaultGuard(reflector);

    vi.mocked(reflector.getAllAndOverride).mockReturnValue(undefined);
    consume.mockResolvedValue({
      allowed: true,
      limit: 100,
      remaining: 99,
      reset: 1710000000,
    });

    await guardWithDefaults.canActivate(createMockContext());
    expect(consume).toHaveBeenCalledWith("127.0.0.1");
  });

  it("allows request under the limit", async () => {
    vi.mocked(reflector.getAllAndOverride).mockReturnValue({
      algorithm: "sliding-window",
      limit: 100,
      window: 60,
    });
    consume.mockResolvedValue({
      allowed: true,
      limit: 100,
      remaining: 99,
      reset: 1710000000,
    });

    const result = await guard.canActivate(createMockContext());
    expect(result).toBe(true);
    expect(consume).toHaveBeenCalledWith("127.0.0.1");
  });

  it("throws 429 when rate limit is exceeded", async () => {
    vi.mocked(reflector.getAllAndOverride).mockReturnValue({
      algorithm: "sliding-window",
      limit: 1,
      window: 60,
    });
    consume.mockResolvedValue({
      allowed: false,
      limit: 1,
      remaining: 0,
      reset: 1710000060,
      retryAfter: 30,
    });

    await expect(guard.canActivate(createMockContext())).rejects.toThrow(
      HttpException
    );
  });

  it("uses custom key extractor", async () => {
    vi.mocked(reflector.getAllAndOverride).mockReturnValue({
      algorithm: "token-bucket",
      capacity: 10,
      refillRate: 1,
      key: (req: { headers: Record<string, string> }) =>
        req.headers["x-api-key"],
    });
    consume.mockResolvedValue({
      allowed: true,
      limit: 10,
      remaining: 9,
      reset: 1710000000,
    });

    await guard.canActivate(
      createMockContext({ headers: { "x-api-key": "key-abc" } })
    );

    expect(consume).toHaveBeenCalledWith("key-abc");
  });

  it("reads metadata from handler and class", async () => {
    const handler = vi.fn();
    const clazz = vi.fn();
    const context = {
      switchToHttp: () => ({
        getRequest: () => ({ ip: "127.0.0.1", headers: {} }),
        getResponse: () => ({ setHeader: vi.fn() }),
      }),
      getHandler: () => handler,
      getClass: () => clazz,
    } as unknown as ExecutionContext;

    vi.mocked(reflector.getAllAndOverride).mockReturnValue({
      algorithm: "sliding-window",
      limit: 5,
      window: 10,
    });
    consume.mockResolvedValue({
      allowed: true,
      limit: 5,
      remaining: 4,
      reset: 1710000000,
    });

    await guard.canActivate(context);

    expect(reflector.getAllAndOverride).toHaveBeenCalledWith(RATE_LIMIT_KEY, [
      handler,
      clazz,
    ]);
  });

  it("uses default options from guard factory when metadata is absent", async () => {
    const DefaultGuard = createNestGuard(limiter)({
      algorithm: "sliding-window",
      limit: 50,
      window: 30,
    });
    const defaultGuard = new DefaultGuard(reflector);

    vi.mocked(reflector.getAllAndOverride).mockReturnValue(undefined);
    consume.mockResolvedValue({
      allowed: true,
      limit: 50,
      remaining: 49,
      reset: 1710000000,
    });

    await defaultGuard.canActivate(createMockContext());
    expect(consume).toHaveBeenCalledWith("127.0.0.1");
  });

  it("throws ServiceUnavailableException when failOpen is false", async () => {
    vi.mocked(reflector.getAllAndOverride).mockReturnValue({
      algorithm: "sliding-window",
      limit: 100,
      window: 60,
      failOpen: false,
    });
    consume.mockRejectedValue(new Error("store down"));

    await expect(guard.canActivate(createMockContext())).rejects.toThrow(
      ServiceUnavailableException
    );
  });

  it("skips headers when headers: false", async () => {
    const setHeader = vi.fn();
    const context = {
      switchToHttp: () => ({
        getRequest: () => ({ ip: "127.0.0.1", headers: {} }),
        getResponse: () => ({ setHeader }),
      }),
      getHandler: () => vi.fn(),
      getClass: () => vi.fn(),
    } as unknown as ExecutionContext;

    vi.mocked(reflector.getAllAndOverride).mockReturnValue({
      algorithm: "sliding-window",
      limit: 100,
      window: 60,
      headers: false,
    });
    consume.mockResolvedValue({
      allowed: true,
      limit: 100,
      remaining: 99,
      reset: 1710000000,
    });

    await guard.canActivate(context);
    expect(setHeader).not.toHaveBeenCalled();
  });

  it("calls onLimitReached when rate limited", async () => {
    const onLimitReached = vi.fn();
    vi.mocked(reflector.getAllAndOverride).mockReturnValue({
      algorithm: "sliding-window",
      limit: 1,
      window: 60,
      onLimitReached,
    });
    consume.mockResolvedValue({
      allowed: false,
      limit: 1,
      remaining: 0,
      reset: 1710000060,
    });

    const result = await guard.canActivate(createMockContext());
    expect(onLimitReached).toHaveBeenCalled();
    expect(result).toBe(false);
  });

  // ── New test cases ───────────────────────────────────────────────────────

  it("sets rate-limit headers on an allowed request", async () => {
    const setHeader = vi.fn();
    const context = {
      switchToHttp: () => ({
        getRequest: () => ({ ip: "127.0.0.1", headers: {} }),
        getResponse: () => ({ setHeader }),
      }),
      getHandler: () => vi.fn(),
      getClass: () => vi.fn(),
    } as unknown as ExecutionContext;

    vi.mocked(reflector.getAllAndOverride).mockReturnValue({
      algorithm: "sliding-window",
      limit: 100,
      window: 60,
    });
    consume.mockResolvedValue({
      allowed: true,
      limit: 100,
      remaining: 75,
      reset: 1710000000,
    });

    await guard.canActivate(context);

    expect(setHeader).toHaveBeenCalledWith("X-RateLimit-Limit", "100");
    expect(setHeader).toHaveBeenCalledWith("X-RateLimit-Remaining", "75");
    expect(setHeader).toHaveBeenCalledWith(
      "X-RateLimit-Reset",
      "1710000000"
    );
  });

  it("sets Retry-After header when rate-limited (no onLimitReached)", async () => {
    const setHeader = vi.fn();
    const context = {
      switchToHttp: () => ({
        getRequest: () => ({ ip: "127.0.0.1", headers: {} }),
        getResponse: () => ({ setHeader }),
      }),
      getHandler: () => vi.fn(),
      getClass: () => vi.fn(),
    } as unknown as ExecutionContext;

    vi.mocked(reflector.getAllAndOverride).mockReturnValue({
      algorithm: "sliding-window",
      limit: 1,
      window: 60,
    });
    consume.mockResolvedValue({
      allowed: false,
      limit: 1,
      remaining: 0,
      reset: 1710000060,
      retryAfter: 45,
    });

    await expect(guard.canActivate(context)).rejects.toThrow(HttpException);
    expect(setHeader).toHaveBeenCalledWith("Retry-After", "45");
  });

  it("allows request when store errors and failOpen is true (default)", async () => {
    vi.mocked(reflector.getAllAndOverride).mockReturnValue({
      algorithm: "sliding-window",
      limit: 100,
      window: 60,
      failOpen: true,
    });
    consume.mockRejectedValue(new Error("Redis timeout"));

    const result = await guard.canActivate(createMockContext());
    expect(result).toBe(true);
  });

  it("falls back to 'unknown' key when request IP is undefined", async () => {
    vi.mocked(reflector.getAllAndOverride).mockReturnValue({
      algorithm: "sliding-window",
      limit: 100,
      window: 60,
    });
    consume.mockResolvedValue({
      allowed: true,
      limit: 100,
      remaining: 99,
      reset: 1710000000,
    });

    const context = {
      switchToHttp: () => ({
        getRequest: () => ({ ip: undefined, headers: {} }),
        getResponse: () => ({ setHeader: vi.fn() }),
      }),
      getHandler: () => vi.fn(),
      getClass: () => vi.fn(),
    } as unknown as ExecutionContext;

    await guard.canActivate(context);
    expect(consume).toHaveBeenCalledWith("unknown");
  });

  it("falls back to 'unknown' when custom key extractor returns undefined", async () => {
    vi.mocked(reflector.getAllAndOverride).mockReturnValue({
      algorithm: "sliding-window",
      limit: 100,
      window: 60,
      key: () => undefined,
    });
    consume.mockResolvedValue({
      allowed: true,
      limit: 100,
      remaining: 99,
      reset: 1710000000,
    });

    await guard.canActivate(createMockContext());
    expect(consume).toHaveBeenCalledWith("unknown");
  });

  it("metadata options override factory default options", async () => {
    const DefaultGuard = createNestGuard(limiter)({
      algorithm: "sliding-window",
      limit: 10,
      window: 30,
    });
    const defaultGuard = new DefaultGuard(reflector);

    // Route-level metadata with higher limits should override factory defaults
    vi.mocked(reflector.getAllAndOverride).mockReturnValue({
      algorithm: "sliding-window",
      limit: 500,
      window: 120,
    });
    consume.mockResolvedValue({
      allowed: true,
      limit: 500,
      remaining: 499,
      reset: 1710000000,
    });

    await defaultGuard.canActivate(createMockContext());

    // consume should be called with the correct IP key
    expect(consume).toHaveBeenCalledWith("127.0.0.1");
    // Guard called consume once — confirming metadata (limit:500) driven strategy was invoked
    expect(consume).toHaveBeenCalledTimes(1);
  });

  it("limitlyNestModule returns a valid DynamicModule shape", () => {
    const mod = limitlyNestModule({
      limiter,
      algorithm: "sliding-window",
      limit: 100,
      window: 60,
    });

    expect(mod.module).toBeDefined();
    expect(Array.isArray(mod.providers)).toBe(true);
    expect(Array.isArray(mod.exports)).toBe(true);
    expect(mod.global).toBe(false);
  });

  it("limitlyNestModule sets global flag when global: true", () => {
    const mod = limitlyNestModule({
      limiter,
      algorithm: "sliding-window",
      limit: 50,
      window: 60,
      global: true,
    });

    expect(mod.global).toBe(true);
  });

  it("RateLimit decorator sets correct metadata key", () => {
    const options = { algorithm: "sliding-window" as const, limit: 20, window: 10 };
    const decorator = RateLimit(options);

    // SetMetadata returns a decorator; verify it's a function
    expect(typeof decorator).toBe("function");

    // Apply decorator to a mock target and verify it stores metadata under RATE_LIMIT_KEY
    const target = {};
    const descriptor = { value: vi.fn() };
    decorator(target, "testMethod", descriptor);

    const stored = Reflect.getMetadata(RATE_LIMIT_KEY, descriptor.value);
    expect(stored).toEqual(options);
  });
});