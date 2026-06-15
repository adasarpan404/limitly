import { readFileSync } from "fs";
import { join } from "path";
import type { RedisClient } from "../types";

const scriptCache = new Map<string, string>();
const shaCache = new Map<string, string>();

function loadScript(name: string): string {
  const cached = scriptCache.get(name);
  if (cached) {
    return cached;
  }

  const scriptPath = join(__dirname, "..", "scripts", `${name}.lua`);
  const script = readFileSync(scriptPath, "utf-8");
  scriptCache.set(name, script);
  return script;
}

export async function loadScriptSha(
  redis: RedisClient,
  name: string
): Promise<string> {
  const cacheKey = getCacheKey(redis, name);
  const cached = shaCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const script = loadScript(name);
  const sha = (await redis.script("LOAD", script)) as string;
  shaCache.set(cacheKey, sha);
  return sha;
}

export async function evalScript(
  redis: RedisClient,
  name: string,
  keys: string[],
  args: (string | number)[]
): Promise<(string | number)[]> {
  const sha = await loadScriptSha(redis, name);

  try {
    const result = await redis.evalsha(
      sha,
      keys.length,
      ...keys,
      ...args.map(String)
    );
    return result as (string | number)[];
  } catch (error) {
    if (isNoScriptError(error)) {
      const script = loadScript(name);
      const result = await redis.eval(
        script,
        keys.length,
        ...keys,
        ...args.map(String)
      );
      const newSha = (await redis.script("LOAD", script)) as string;
      shaCache.set(getCacheKey(redis, name), newSha);
      return result as (string | number)[];
    }
    throw error;
  }
}

function getCacheKey(redis: RedisClient, name: string): string {
  const status = redis.status ?? "unknown";
  return `${status}:${name}`;
}

function isNoScriptError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.message.includes("NOSCRIPT") ||
      error.message.includes("No matching script"))
  );
}

export function parseScriptResult(
  result: (string | number)[]
): {
  allowed: boolean;
  limit: number;
  remaining: number;
  reset: number;
  retryAfter: number;
} {
  return {
    allowed: Number(result[0]) === 1,
    limit: Number(result[1]),
    remaining: Number(result[2]),
    reset: Number(result[3]),
    retryAfter: Number(result[4]),
  };
}