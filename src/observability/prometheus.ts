import {
  Counter,
  Histogram,
  Registry,
  type RegistryContentType,
} from "prom-client";
import type { RateLimitMetricsEvent, RateLimitMetricsHook } from "../types";

export const DEFAULT_PROMETHEUS_PREFIX = "limitly";

export interface PrometheusExporterOptions {
  /** Prometheus registry. Defaults to a new `Registry`. */
  register?: Registry;
  /** Metric name prefix. Defaults to `"limitly"`. */
  prefix?: string;
  /** Include the rate limit key as a label. Defaults to `false` (high cardinality). */
  includeKey?: boolean;
  /** Histogram buckets for check duration in seconds. */
  durationBuckets?: number[];
}

export interface PrometheusExporter {
  register: Registry;
  onMetrics: RateLimitMetricsHook;
  contentType: RegistryContentType;
  getMetrics: () => Promise<string>;
}

interface PrometheusMetricSet {
  checksTotal: Counter<string>;
  checkDuration: Histogram<string>;
}

const metricCache = new WeakMap<Registry, Map<string, PrometheusMetricSet>>();

const DEFAULT_DURATION_BUCKETS = [
  0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1,
];

function getMetricSet(
  register: Registry,
  prefix: string,
  durationBuckets: number[],
  includeKey: boolean
): PrometheusMetricSet {
  const cacheKey = `${prefix}:${includeKey ? "key" : "nokey"}`;
  let byCacheKey = metricCache.get(register);
  if (!byCacheKey) {
    byCacheKey = new Map();
    metricCache.set(register, byCacheKey);
  }

  const cached = byCacheKey.get(cacheKey);
  if (cached) {
    return cached;
  }

  const labelNames = includeKey
    ? (["algorithm", "outcome", "store", "key"] as const)
    : (["algorithm", "outcome", "store"] as const);

  const metrics: PrometheusMetricSet = {
    checksTotal: new Counter({
      name: `${prefix}_check_total`,
      help: "Total number of rate limit checks",
      labelNames: [...labelNames],
      registers: [register],
    }),
    checkDuration: new Histogram({
      name: `${prefix}_check_duration_seconds`,
      help: "Duration of rate limit checks in seconds",
      labelNames: [...labelNames],
      buckets: durationBuckets,
      registers: [register],
    }),
  };

  byCacheKey.set(cacheKey, metrics);
  return metrics;
}

function sanitizeLabel(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 128);
}

function getLabels(
  event: RateLimitMetricsEvent,
  includeKey: boolean
): Record<string, string> {
  const labels: Record<string, string> = {
    algorithm: event.algorithm,
    outcome: event.type,
    store: event.store ?? "unknown",
  };

  if (includeKey) {
    labels.key = sanitizeLabel(event.key);
  }

  return labels;
}

export function createPrometheusMetricsHook(
  options: PrometheusExporterOptions = {}
): RateLimitMetricsHook {
  const register = options.register ?? new Registry();
  const prefix = options.prefix ?? DEFAULT_PROMETHEUS_PREFIX;
  const includeKey = options.includeKey ?? false;
  const durationBuckets = options.durationBuckets ?? DEFAULT_DURATION_BUCKETS;
  const metrics = getMetricSet(register, prefix, durationBuckets, includeKey);

  return (event) => {
    const labels = getLabels(event, includeKey);
    metrics.checksTotal.inc(labels);
    metrics.checkDuration.observe(labels, event.durationMs / 1000);
  };
}

export function createPrometheusExporter(
  options: PrometheusExporterOptions = {}
): PrometheusExporter {
  const register = options.register ?? new Registry();
  const onMetrics = createPrometheusMetricsHook({ ...options, register });

  return {
    register,
    onMetrics,
    contentType: register.contentType,
    getMetrics: () => register.metrics(),
  };
}

export type PrometheusHandler = (
  req: unknown,
  res: {
    setHeader(name: string, value: string): void;
    end(body: string): void;
  }
) => Promise<void>;

export function createPrometheusHandler(
  exporter: PrometheusExporter
): PrometheusHandler {
  return async (_req, res) => {
    const body = await exporter.getMetrics();
    res.setHeader("Content-Type", exporter.contentType);
    res.end(body);
  };
}