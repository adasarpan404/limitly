import Redis, { Cluster, type RedisOptions } from "ioredis";
import type { RedisClient, RedisConfig } from "../types";

export function createRedisClient(config: RedisConfig): RedisClient {
  if (isRedisClient(config)) {
    return config;
  }

  if (typeof config === "string") {
    return new Redis(config);
  }

  if (isClusterConfig(config)) {
    return new Cluster(config.nodes, config.options);
  }

  return new Redis(config);
}

function isRedisClient(config: RedisConfig): config is RedisClient {
  return config instanceof Redis || config instanceof Cluster;
}

function isClusterConfig(
  config: RedisConfig
): config is { nodes: { host: string; port: number }[]; options?: RedisOptions } {
  return (
    typeof config === "object" &&
    config !== null &&
    "nodes" in config &&
    Array.isArray((config as { nodes: unknown }).nodes)
  );
}

export function buildKey(prefix: string, key: string): string {
  return `${prefix}:${key}`;
}