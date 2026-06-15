import Redis from "ioredis";

let redis: Redis | null = null;

export async function getTestRedis(): Promise<Redis | null> {
  if (redis) {
    return redis;
  }

  const client = new Redis({
    host: process.env.REDIS_HOST ?? "localhost",
    port: Number(process.env.REDIS_PORT ?? 6379),
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    connectTimeout: 2000,
  });

  try {
    await client.connect();
    redis = client;
    return redis;
  } catch {
    await client.quit().catch(() => undefined);
    return null;
  }
}

export async function flushTestKeys(client: Redis, prefix = "redislimit:test"): Promise<void> {
  const keys = await client.keys(`${prefix}*`);
  if (keys.length > 0) {
    await client.del(...keys);
  }
}

export async function cleanupRedis(): Promise<void> {
  if (redis) {
    await redis.quit();
    redis = null;
  }
}