import { readFileSync } from "fs";
import { join } from "path";
import { Cluster } from "ioredis";
import type { RedisClient } from "../types";

function isRedisCluster(client: RedisClient): client is Cluster {
  return client instanceof Cluster || client.isCluster === true;
}

export const SCRIPT_COMMANDS = {
  sliding: "limitlySliding",
  token: "limitlyToken",
  concurrencyAcquire: "limitlyConcurrencyAcquire",
  concurrencyRelease: "limitlyConcurrencyRelease",
  gcra: "limitlyGcra",
} as const;

export type ScriptName = keyof typeof SCRIPT_COMMANDS;

const scriptCache = new Map<string, string>();
const registeredClients = new WeakSet<object>();

function loadScript(name: ScriptName): string {
  const cached = scriptCache.get(name);
  if (cached) {
    return cached;
  }

  const scriptPath = join(__dirname, "..", "scripts", `${name}.lua`);
  const script = readFileSync(scriptPath, "utf-8");
  scriptCache.set(name, script);
  return script;
}

export function getClusterScriptDefinitions(): Record<
  string,
  { lua: string; numberOfKeys: number }
> {
  return {
    [SCRIPT_COMMANDS.sliding]: {
      numberOfKeys: 1,
      lua: loadScript("sliding"),
    },
    [SCRIPT_COMMANDS.token]: {
      numberOfKeys: 1,
      lua: loadScript("token"),
    },
    [SCRIPT_COMMANDS.concurrencyAcquire]: {
      numberOfKeys: 1,
      lua: loadScript("concurrencyAcquire"),
    },
    [SCRIPT_COMMANDS.concurrencyRelease]: {
      numberOfKeys: 1,
      lua: loadScript("concurrencyRelease"),
    },
    [SCRIPT_COMMANDS.gcra]: {
      numberOfKeys: 1,
      lua: loadScript("gcra"),
    },
  };
}

export function registerRedisScripts(redis: RedisClient): void {
  if (registeredClients.has(redis)) {
    return;
  }

  for (const name of Object.keys(SCRIPT_COMMANDS) as ScriptName[]) {
    const command = SCRIPT_COMMANDS[name];
    redis.defineCommand(command, {
      numberOfKeys: 1,
      lua: loadScript(name),
    });
  }

  registeredClients.add(redis);
}

export async function warmupRedisScripts(redis: RedisClient): Promise<void> {
  registerRedisScripts(redis);

  if (!isRedisCluster(redis)) {
    return;
  }

  const masters = redis.nodes("master");
  if (masters.length === 0) {
    return;
  }

  const definitions = getClusterScriptDefinitions();
  await Promise.all(
    masters.flatMap((node) =>
      Object.values(definitions).map((definition) =>
        node.script("LOAD", definition.lua)
      )
    )
  );
}

type ScriptRunner = (
  ...args: (string | number)[]
) => Promise<(string | number)[]>;

function getScriptRunner(redis: RedisClient, name: ScriptName): ScriptRunner {
  const command = SCRIPT_COMMANDS[name];
  const runner = (redis as unknown as Record<string, ScriptRunner | undefined>)[
    command
  ];

  if (!runner) {
    throw new Error(`Redis script command "${command}" is not registered`);
  }

  return runner.bind(redis) as ScriptRunner;
}

export async function evalScript(
  redis: RedisClient,
  name: ScriptName,
  keys: string[],
  args: (string | number)[]
): Promise<(string | number)[]> {
  registerRedisScripts(redis);
  const runner = getScriptRunner(redis, name);
  const result = await runner(...keys, ...args);
  return result;
}

export function parseScriptResult(
  result: (string | number)[]
): {
  allowed: boolean;
  limit: number;
  remaining: number;
  reset: number;
  retryAfter: number;
  slotId?: string;
} {
  const parsed = {
    allowed: Number(result[0]) === 1,
    limit: Number(result[1]),
    remaining: Number(result[2]),
    reset: Number(result[3]),
    retryAfter: Number(result[4]),
    slotId: undefined as string | undefined,
  };

  const slotId = result[5];
  if (parsed.allowed && slotId !== undefined && String(slotId).length > 0) {
    parsed.slotId = String(slotId);
  }

  return parsed;
}