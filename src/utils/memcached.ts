import Memcached from "memcached";
import type { MemcachedConfig, MemcachedClient } from "../types";

export function createMemcachedClient(config: MemcachedConfig): MemcachedClient {
  if (isMemcachedClient(config)) {
    return config;
  }

  if (typeof config === "string" || Array.isArray(config)) {
    return new Memcached(config);
  }

  return new Memcached(config.servers, config.options);
}

function isMemcachedClient(config: MemcachedConfig): config is MemcachedClient {
  return (
    typeof config === "object" &&
    config !== null &&
    "incr" in config &&
    typeof (config as MemcachedClient).incr === "function"
  );
}

export function memcachedGet(
  client: MemcachedClient,
  key: string
): Promise<string | undefined> {
  return new Promise((resolve, reject) => {
    client.get(key, (err: Error | undefined, data: Buffer | undefined) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(data?.toString());
    });
  });
}

export function memcachedGets(
  client: MemcachedClient,
  key: string
): Promise<{ value: string; cas: string } | undefined> {
  return new Promise((resolve, reject) => {
    client.gets(key, (err: Error | undefined, data?: { cas: string; value?: Buffer }) => {
      if (err) {
        reject(err);
        return;
      }
      if (!data?.value) {
        resolve(undefined);
        return;
      }
      resolve({ value: data.value.toString(), cas: String(data.cas) });
    });
  });
}

export function memcachedIncr(
  client: MemcachedClient,
  key: string,
  amount = 1
): Promise<number> {
  return new Promise((resolve, reject) => {
    client.incr(key, amount, (err: Error | undefined, result?: number | boolean) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(Number(result));
    });
  });
}

export function memcachedDecr(
  client: MemcachedClient,
  key: string,
  amount = 1
): Promise<number> {
  return new Promise((resolve, reject) => {
    client.decr(key, amount, (err: Error | undefined, result?: number | boolean) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(Number(result));
    });
  });
}

export function memcachedAdd(
  client: MemcachedClient,
  key: string,
  value: string,
  ttl: number
): Promise<void> {
  return new Promise((resolve, reject) => {
    client.add(key, value, ttl, (err: NodeJS.ErrnoException | undefined) => {
      if (err && (err as NodeJS.ErrnoException).code !== "EEXIST") {
        reject(err);
        return;
      }
      resolve();
    });
  });
}

export function memcachedCas(
  client: MemcachedClient,
  key: string,
  value: string,
  cas: string,
  ttl: number
): Promise<boolean> {
  return new Promise((resolve, reject) => {
    client.cas(key, value, cas, ttl, (err: NodeJS.ErrnoException | undefined) => {
      if (err) {
        if ((err as NodeJS.ErrnoException).code === "EEXIST") {
          resolve(false);
          return;
        }
        reject(err);
        return;
      }
      resolve(true);
    });
  });
}