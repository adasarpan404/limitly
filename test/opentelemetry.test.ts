import { describe, it, expect, vi } from "vitest";
import {
  createOpenTelemetryInstrumentation,
  createOpenTelemetryMetricsHook,
  createOpenTelemetryTracer,
} from "../src/observability/opentelemetry";
import type { RateLimitMetricsEvent } from "../src/types";

function createMockMeter() {
  const counters = new Map<string, ReturnType<typeof vi.fn>>();
  const histograms = new Map<string, ReturnType<typeof vi.fn>>();

  return {
    createCounter: vi.fn((name: string) => {
      const add = vi.fn();
      counters.set(name, add);
      return { add };
    }),
    createHistogram: vi.fn((name: string) => {
      const record = vi.fn();
      histograms.set(name, record);
      return { record };
    }),
    counters,
    histograms,
  };
}

function createMockTracer() {
  const spans: Array<{
    name: string;
    attributes: Record<string, unknown>;
    status?: unknown;
    ended: boolean;
  }> = [];

  const tracer = {
    startSpan: vi.fn(
      (
        name: string,
        options?: { attributes?: Record<string, unknown> },
        _ctx?: unknown
      ) => {
        const span = {
          name,
          attributes: { ...options?.attributes },
          status: undefined as unknown,
          ended: false,
          setAttribute(key: string, value: unknown) {
            span.attributes[key] = value;
          },
          setStatus(status: unknown) {
            span.status = status;
          },
          end() {
            span.ended = true;
          },
        };
        spans.push(span);
        return span;
      }
    ),
    spans,
  };

  return tracer;
}

function createEvent(
  overrides: Partial<RateLimitMetricsEvent> = {}
): RateLimitMetricsEvent {
  return {
    type: "allowed",
    key: "user-1",
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

describe("createOpenTelemetryMetricsHook", () => {
  it("records counter and histogram for allowed checks", () => {
    const meter = createMockMeter();
    const onMetrics = createOpenTelemetryMetricsHook({ meter: meter as never });

    onMetrics(createEvent());

    expect(meter.createCounter).toHaveBeenCalledWith("limitly.check.total", {
      description: "Total number of rate limit checks",
    });
    expect(meter.createHistogram).toHaveBeenCalledWith("limitly.check.duration", {
      description: "Duration of rate limit checks",
      unit: "ms",
    });

    const counter = meter.counters.get("limitly.check.total");
    const histogram = meter.histograms.get("limitly.check.duration");

    expect(counter).toHaveBeenCalledWith(1, {
      "limitly.algorithm": "sliding-window",
      "limitly.outcome": "allowed",
      "limitly.store": "redis",
    });
    expect(histogram).toHaveBeenCalledWith(4.2, {
      "limitly.algorithm": "sliding-window",
      "limitly.outcome": "allowed",
      "limitly.store": "redis",
    });
  });

  it("includes key when includeKey is true", () => {
    const meter = createMockMeter();
    const onMetrics = createOpenTelemetryMetricsHook({
      meter: meter as never,
      includeKey: true,
    });

    onMetrics(createEvent({ type: "blocked" }));

    const counter = meter.counters.get("limitly.check.total");
    expect(counter).toHaveBeenCalledWith(1, {
      "limitly.algorithm": "sliding-window",
      "limitly.outcome": "blocked",
      "limitly.store": "redis",
      "limitly.key": "user-1",
    });
  });
});

describe("createOpenTelemetryTracer", () => {
  it("creates spans with attributes and status", () => {
    const otelTracer = createMockTracer();
    const tracer = createOpenTelemetryTracer({ tracer: otelTracer as never });

    const span = tracer.startSpan("limitly.check", {
      "limitly.algorithm": "token-bucket",
      "limitly.store": "redis",
    });

    span.setAttribute("limitly.outcome", "blocked");
    span.setAttribute("limitly.limit", 10);
    span.setAttribute("limitly.remaining", 0);
    span.setAttribute("limitly.allowed", false);
    span.setStatus(true);
    span.end();

    expect(otelTracer.startSpan).toHaveBeenCalledWith(
      "limitly.check",
      {
        attributes: {
          "limitly.algorithm": "token-bucket",
          "limitly.store": "redis",
        },
      },
      expect.anything()
    );

    const created = otelTracer.spans[0];
    expect(created.attributes).toMatchObject({
      "limitly.algorithm": "token-bucket",
      "limitly.store": "redis",
      "limitly.outcome": "blocked",
      "limitly.limit": 10,
      "limitly.remaining": 0,
      "limitly.allowed": false,
    });
    expect(created.ended).toBe(true);
  });

  it("marks spans as error when setStatus fails", () => {
    const otelTracer = createMockTracer();
    const tracer = createOpenTelemetryTracer({ tracer: otelTracer as never });
    const span = tracer.startSpan("limitly.check");

    span.setStatus(false, "Redis down");
    span.end();

    expect(otelTracer.spans[0].status).toEqual({
      code: 2,
      message: "Redis down",
    });
  });
});

describe("createOpenTelemetryInstrumentation", () => {
  it("returns tracer and metrics hook", () => {
    const meter = createMockMeter();
    const otelTracer = createMockTracer();

    const instrumentation = createOpenTelemetryInstrumentation({
      meter: meter as never,
      tracer: otelTracer as never,
    });

    expect(instrumentation.tracer).toBeDefined();
    expect(instrumentation.onMetrics).toBeTypeOf("function");
  });
});