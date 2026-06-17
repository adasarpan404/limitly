import {
  context,
  metrics,
  SpanStatusCode,
  trace,
  type Meter,
  type Tracer,
} from "@opentelemetry/api";
import type {
  RateLimitMetricsEvent,
  RateLimitMetricsHook,
} from "../types";
import type { RateLimitTracer } from "./types";

export const DEFAULT_METER_NAME = "limitly";
export const DEFAULT_TRACER_NAME = "limitly";

export interface OpenTelemetryMetricsOptions {
  /** OpenTelemetry meter. Defaults to `metrics.getMeter("limitly")`. */
  meter?: Meter;
  /** Meter scope name. Defaults to `"limitly"`. */
  meterName?: string;
  /** Include the rate limit key in metric attributes. Defaults to `false`. */
  includeKey?: boolean;
}

export interface OpenTelemetryTracerOptions {
  /** OpenTelemetry tracer. Defaults to `trace.getTracer("limitly")`. */
  tracer?: Tracer;
  /** Tracer scope name. Defaults to `"limitly"`. */
  tracerName?: string;
}

export interface OpenTelemetryInstrumentationOptions
  extends OpenTelemetryMetricsOptions,
    OpenTelemetryTracerOptions {}

interface MetricInstruments {
  checksTotal: ReturnType<Meter["createCounter"]>;
  checkDuration: ReturnType<Meter["createHistogram"]>;
}

const instrumentCache = new WeakMap<Meter, MetricInstruments>();

function getMetricInstruments(
  meter: Meter,
  meterName: string
): MetricInstruments {
  const cached = instrumentCache.get(meter);
  if (cached) {
    return cached;
  }

  const instruments: MetricInstruments = {
    checksTotal: meter.createCounter(`${meterName}.check.total`, {
      description: "Total number of rate limit checks",
    }),
    checkDuration: meter.createHistogram(`${meterName}.check.duration`, {
      description: "Duration of rate limit checks",
      unit: "ms",
    }),
  };

  instrumentCache.set(meter, instruments);
  return instruments;
}

function getBaseMetricAttributes(
  event: RateLimitMetricsEvent,
  includeKey: boolean
): Record<string, string> {
  const attributes: Record<string, string> = {
    "limitly.algorithm": event.algorithm,
    "limitly.outcome": event.type,
  };

  if (event.store) {
    attributes["limitly.store"] = event.store;
  }

  if (includeKey) {
    attributes["limitly.key"] = event.key;
  }

  return attributes;
}

export function createOpenTelemetryMetricsHook(
  options: OpenTelemetryMetricsOptions = {}
): RateLimitMetricsHook {
  const meterName = options.meterName ?? DEFAULT_METER_NAME;
  const meter = options.meter ?? metrics.getMeter(meterName);
  const includeKey = options.includeKey ?? false;
  const instruments = getMetricInstruments(meter, meterName);

  return (event) => {
    const attributes = getBaseMetricAttributes(event, includeKey);
    instruments.checksTotal.add(1, attributes);
    instruments.checkDuration.record(event.durationMs, attributes);
  };
}

export function createOpenTelemetryTracer(
  options: OpenTelemetryTracerOptions = {}
): RateLimitTracer {
  const tracerName = options.tracerName ?? DEFAULT_TRACER_NAME;
  const otelTracer = options.tracer ?? trace.getTracer(tracerName);

  return {
    startSpan(name, attributes) {
      const span = otelTracer.startSpan(name, { attributes }, context.active());

      return {
        setAttribute(key, value) {
          span.setAttribute(key, value);
        },
        setStatus(ok, message) {
          if (ok) {
            span.setStatus({ code: SpanStatusCode.OK });
            return;
          }

          span.setStatus({
            code: SpanStatusCode.ERROR,
            message,
          });
        },
        end() {
          span.end();
        },
      };
    },
  };
}

export function createOpenTelemetryInstrumentation(
  options: OpenTelemetryInstrumentationOptions = {}
): {
  tracer: RateLimitTracer;
  onMetrics: RateLimitMetricsHook;
} {
  return {
    tracer: createOpenTelemetryTracer(options),
    onMetrics: createOpenTelemetryMetricsHook(options),
  };
}