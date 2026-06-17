import { Cluster, Redis } from "ioredis";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { RedisStore } from "../src/stores/redis-store";
import {
  DEFAULT_CLUSTER_OPTIONS,
  buildKey,
  createRedisClient,
  isRedisCluster,
} from "../src/utils/redis";
import {
  SCRIPT_COMMANDS,
  evalScript,
  getClusterScriptDefinitions,
  registerRedisScripts,
  warmupRedisScripts,
} from "../src/utils/scripts";

function createMockRedis() {
  const commands = new Map<string, { lua: string; numberOfKeys: number }>();
  const runners = new Map<string, ReturnType<typeof vi.fn>>();

  const redis = {
    status: "ready",
    isCluster: false,
    defineCommand: vi.fn(
      (
        name: string,
        definition: { lua: string; numberOfKeys: number }
      ) => {
        commands.set(name, definition);
        const runner = vi.fn();
        runners.set(name, runner);
        (redis as Record<string, unknown>)[name] = runner;
      }
    ),
    commands,
    runners,
  };

  return redis;
}

function createMockCluster() {
  const redis = createMockRedis();
  const masters = [
    {
      script: vi.fn().mockResolvedValue("sha-sliding"),
    },
    {
      script: vi.fn().mockResolvedValue("sha-sliding"),
    },
  ];

  const cluster = {
    ...redis,
    isCluster: true,
    nodes: vi.fn().mockReturnValue(masters),
    masters,
  };

  Object.setPrototypeOf(cluster, Cluster.prototype);

  return cluster;
}

describe("buildKey cluster hash tags", () => {
  it("distributes keys across slots by default", () => {
    expect(buildKey("limitly", "sw:203.0.113.1")).toBe(
      "limitly:sw:203.0.113.1"
    );
  });

  it("pins keys to a slot when hashTag is provided", () => {
    expect(buildKey("limitly", "sw:203.0.113.1", "limitly")).toBe(
      "{limitly}:limitly:sw:203.0.113.1"
    );
  });
});

describe("createRedisClient cluster defaults", () => {
  it("creates a Cluster with production-oriented defaults", () => {
    const client = createRedisClient({
      nodes: [{ host: "127.0.0.1", port: 7000 }],
      options: { lazyConnect: true },
    });

    expect(client).toBeInstanceOf(Cluster);
    expect(client.options.scaleReads).toBe(DEFAULT_CLUSTER_OPTIONS.scaleReads);
    expect(client.options.enableAutoPipelining).toBe(true);
    expect(client.options.redisOptions?.maxRetriesPerRequest).toBeNull();
    expect(client.options.scripts?.[SCRIPT_COMMANDS.sliding]).toBeDefined();
    expect(client.options.scripts?.[SCRIPT_COMMANDS.token]).toBeDefined();
  });
});

describe("registerRedisScripts", () => {
  it("defines limitly commands on standalone Redis", () => {
    const redis = createMockRedis();

    registerRedisScripts(redis as never);

    expect(redis.defineCommand).toHaveBeenCalledTimes(5);
    expect(redis.commands.has(SCRIPT_COMMANDS.sliding)).toBe(true);
    expect(redis.commands.has(SCRIPT_COMMANDS.token)).toBe(true);
  });

  it("is idempotent", () => {
    const redis = createMockRedis();

    registerRedisScripts(redis as never);
    registerRedisScripts(redis as never);

    expect(redis.defineCommand).toHaveBeenCalledTimes(5);
  });
});

describe("warmupRedisScripts", () => {
  it("loads scripts on all cluster masters", async () => {
    const cluster = createMockCluster();

    await warmupRedisScripts(cluster as never);

    expect(cluster.nodes).toHaveBeenCalledWith("master");
    expect(cluster.masters[0].script).toHaveBeenCalledTimes(5);
    expect(cluster.masters[1].script).toHaveBeenCalledTimes(5);
  });

  it("skips warmup for standalone Redis", async () => {
    const redis = createMockRedis();
    redis.nodes = vi.fn();

    await warmupRedisScripts(redis as never);

    expect(redis.nodes).not.toHaveBeenCalled();
  });
});

describe("evalScript", () => {
  it("uses defineCommand runners", async () => {
    const redis = createMockRedis();
    registerRedisScripts(redis as never);
    redis.runners
      .get(SCRIPT_COMMANDS.sliding)!
      .mockResolvedValue([1, 100, 99, 1710000000, 0]);

    const result = await evalScript(
      redis as never,
      "sliding",
      ["limitly:sw:user-1"],
      [100, 60, Date.now(), "req-1"]
    );

    expect(redis.runners.get(SCRIPT_COMMANDS.sliding)).toHaveBeenCalled();
    expect(result).toEqual([1, 100, 99, 1710000000, 0]);
  });
});

describe("getClusterScriptDefinitions", () => {
  it("returns all limitly scripts", () => {
    const definitions = getClusterScriptDefinitions();

    expect(definitions[SCRIPT_COMMANDS.sliding].numberOfKeys).toBe(1);
    expect(definitions[SCRIPT_COMMANDS.sliding].lua).toContain("ZREMRANGEBYSCORE");
    expect(definitions[SCRIPT_COMMANDS.token].lua).toContain("HMGET");
    expect(definitions[SCRIPT_COMMANDS.concurrencyAcquire].lua).toContain(
      "ZREMRANGEBYSCORE"
    );
    expect(definitions[SCRIPT_COMMANDS.concurrencyRelease].lua).toContain(
      "ZREM"
    );
    expect(definitions[SCRIPT_COMMANDS.gcra].lua).toContain("burst_tolerance");
  });
});

describe("RedisStore cluster integration", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("detects cluster clients", () => {
    const cluster = createMockCluster();
    expect(isRedisCluster(cluster as never)).toBe(true);

    const redis = new Redis({ lazyConnect: true });
    expect(isRedisCluster(redis)).toBe(false);
  });

  it("uses hashTag in redis keys", async () => {
    const redis = createMockRedis();
    registerRedisScripts(redis as never);
    redis.runners
      .get(SCRIPT_COMMANDS.sliding)!
      .mockResolvedValue([1, 2, 1, 1710000000, 0]);

    const store = new RedisStore(redis as never, "limitly", "redis", {
      hashTag: "tenant-a",
      warmupScripts: false,
    });

    await store.slidingWindow("user-1", 2, 60);

    expect(redis.runners.get(SCRIPT_COMMANDS.sliding)).toHaveBeenCalledWith(
      "{tenant-a}:limitly:sw:user-1",
      2,
      60,
      expect.any(Number),
      expect.any(String)
    );
  });
});