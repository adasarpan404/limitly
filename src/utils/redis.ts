import Redis, { Cluster, type ClusterOptions } from "ioredis";
import type { RedisClient, RedisConfig } from "../types";
import { getClusterScriptDefinitions } from "./scripts";

export const DEFAULT_KEY_PREFIX = "limitly";

export const DEFAULT_CLUSTER_OPTIONS: ClusterOptions = {
  scaleReads: "master",
  enableReadyCheck: true,
  maxRedirections: 16,
  retryDelayOnFailover: 100,
  retryDelayOnClusterDown: 300,
  slotsRefreshTimeout: 2000,
  enableAutoPipelining: true,
  redisOptions: {
    maxRetriesPerRequest: null,
  },
};

export function isRedisCluster(client: RedisClient): client is Cluster {
  return client instanceof Cluster || client.isCluster === true;
}

export function createRedisClient(config: RedisConfig): RedisClient {
  if (isRedisClient(config)) {
    return config;
  }

  if (typeof config === "string") {
    return new Redis(config);
  }

  if (isClusterConfig(config)) {
    const { nodes, options } = config;
    return new Cluster(nodes, {
      ...DEFAULT_CLUSTER_OPTIONS,
      ...options,
      scripts: {
        ...getClusterScriptDefinitions(),
        ...options?.scripts,
      },
      redisOptions: {
        ...DEFAULT_CLUSTER_OPTIONS.redisOptions,
        ...options?.redisOptions,
      },
    });
  }

  return new Redis(config);
}

function isRedisClient(config: RedisConfig): config is RedisClient {
  return config instanceof Redis || config instanceof Cluster;
}

function isClusterConfig(
  config: RedisConfig
): config is { nodes: { host: string; port: number }[]; options?: ClusterOptions } {
  return (
    typeof config === "object" &&
    config !== null &&
    "nodes" in config &&
    Array.isArray((config as { nodes: unknown }).nodes)
  );
}

export function buildKey(
  prefix: string,
  key: string,
  hashTag?: string
): string {
  const namespaced = `${prefix}:${key}`;

  if (!hashTag) {
    return namespaced;
  }

  return `{${hashTag}}:${namespaced}`;
}