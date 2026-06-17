import { describe, it, expect } from "vitest";
import { Registry } from "prom-client";
import {
  createPrometheusExporter,
  createPrometheusHandler,
  createPrometheusMetricsHook,
} from "../src/observability/prometheus";
import type { RateLimitMetricsEvent } from "../src/types";

function createEvent(
  overrides: Partial<RateLimitMetricsEvent> = {}
): RateLimitMetricsEvent {
  return {
    type: "allowed",
    key: "user@example.com",
    algorithm: "sliding-window",
    result: {
      allowed: true,
      limit: 100,
      remaining: 99,
      reset: 1710000000,
    },
    durationMs: 4.2,
    store: "redis",
    ...overrides,
  } as RateLimitMetricsEvent;
}

describe("createPrometheusMetricsHook", () => {
  it("records counter and histogram metrics", async () => {
    const register = new Registry();
    const onMetrics = createPrometheusMetricsHook({ register });

    onMetrics(createEvent());
    onMetrics(createEvent({ type: "blocked" }));

    const output = await register.metrics();

    expect(output).toContain("limitly_check_total");
    expect(output).toContain('outcome="allowed"');
    expect(output).toContain('outcome="blocked"');
    expect(output).toContain('algorithm="sliding-window"');
    expect(output).toContain('store="redis"');
    expect(output).toContain("limitly_check_duration_seconds");
    expect(output).toContain('le="0.01"');
  });

  it("sanitizes key label when includeKey is true", async () => {
    const register = new Registry();
    const onMetrics = createPrometheusMetricsHook({
      register,
      includeKey: true,
    });

    onMetrics(createEvent());

    const output = await register.metrics();
    expect(output).toContain('key="user_example_com"');
  });

  it("uses unknown store label when store is missing", async () => {
    const register = new Registry();
    const onMetrics = createPrometheusMetricsHook({ register });

    onMetrics(createEvent({ store: undefined }));

    const output = await register.metrics();
    expect(output).toContain('store="unknown"');
  });
});

describe("createPrometheusExporter", () => {
  it("returns registry, hook, and scrape helpers", async () => {
    const exporter = createPrometheusExporter();

    exporter.onMetrics(createEvent({ type: "error", error: new Error("down") }));
    exporter.onMetrics(createEvent({ type: "fail_open" }));

    const output = await exporter.getMetrics();

    expect(output).toContain('outcome="error"');
    expect(output).toContain('outcome="fail_open"');
    expect(exporter.contentType).toContain("text/plain");
  });
});

describe("createPrometheusHandler", () => {
  it("writes metrics with prometheus content type", async () => {
    const exporter = createPrometheusExporter();
    exporter.onMetrics(createEvent());

    const handler = createPrometheusHandler(exporter);
    const headers: Record<string, string> = {};
    let body = "";

    await handler(
      {},
      {
        setHeader(name, value) {
          headers[name] = value;
        },
        end(payload) {
          body = payload;
        },
      }
    );

    expect(headers["Content-Type"]).toBe(exporter.contentType);
    expect(body).toContain("limitly_check_total");
  });
});