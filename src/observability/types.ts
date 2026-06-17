export interface RateLimitSpan {
  setAttribute(key: string, value: string | number | boolean): void;
  setStatus(ok: boolean, message?: string): void;
  end(): void;
}

export interface RateLimitTracer {
  startSpan(
    name: string,
    attributes?: Record<string, string | number | boolean>
  ): RateLimitSpan;
}