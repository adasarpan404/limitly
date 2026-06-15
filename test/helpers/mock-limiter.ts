import { vi } from "vitest";
import type { RedisLimit } from "../../src/limiter";
import type { RateLimitResult } from "../../src/types";

export function createMockLimiter(
  consumeImpl?: ReturnType<typeof vi.fn>
): {
  limiter: RedisLimit;
  consume: ReturnType<typeof vi.fn>;
} {
  const consume =
    consumeImpl ??
    vi.fn().mockResolvedValue({
      allowed: true,
      limit: 100,
      remaining: 99,
      reset: 1710000000,
    } satisfies RateLimitResult);

  const limiter = {
    getStoreType: vi.fn(() => "redis" as const),
    createStrategy: vi.fn(() => ({ consume })),
  } as unknown as RedisLimit;

  return { limiter, consume };
}