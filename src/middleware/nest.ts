import {
  CanActivate,
  DynamicModule,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  Module,
  ServiceUnavailableException,
  SetMetadata,
  type Type,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request, Response } from "express";
import type { RedisLimit } from "../limiter";
import type { MiddlewareOptionsInput } from "../types";
import { buildRateLimitHeaders, setHeaders } from "../utils/headers";
import { consumeRateLimit } from "../utils/metrics";

const DEFAULT_KEY = (req: Request): string => req.ip ?? "unknown";

export const RATE_LIMIT_KEY = "limitly:rate-limit";

export const RateLimit = (options: MiddlewareOptionsInput) =>
  SetMetadata(RATE_LIMIT_KEY, options);

export type NestRateLimitOptions = MiddlewareOptionsInput & {
  limiter: RedisLimit;
  global?: boolean;
};

export function createNestGuard(limiter: RedisLimit) {
  return function guard(
    defaultOptions?: MiddlewareOptionsInput
  ): Type<CanActivate> {
    @Injectable()
    class NestGuard implements CanActivate {
      constructor(private readonly reflector: Reflector) {}

      async canActivate(context: ExecutionContext): Promise<boolean> {
        const metadata = this.reflector.getAllAndOverride<MiddlewareOptionsInput>(
          RATE_LIMIT_KEY,
          [context.getHandler(), context.getClass()]
        );

        const shouldApply =
          metadata !== undefined ||
          defaultOptions !== undefined ||
          Object.keys(limiter.getDefaultOptions()).length > 0;

        if (!shouldApply) {
          return true;
        }

        const options = limiter.resolveOptions({
          ...defaultOptions,
          ...metadata,
        });

        const strategy = limiter.createStrategy(options);
        const http = context.switchToHttp();
        const request = http.getRequest<Request>();
        const response = http.getResponse<Response>();

        const keyExtractor = (options.key ?? DEFAULT_KEY) as (
          req: Request
        ) => string | undefined;
        const key = keyExtractor(request) ?? "unknown";
        const sendHeaders = options.headers !== false;
        const failOpen = options.failOpen ?? true;

        const outcome = await consumeRateLimit({
          strategy,
          key,
          options,
          failOpen,
          storeType: limiter.getStoreType(),
          context: context,
        });

        if (outcome.status === "error") {
          if (failOpen) {
            return true;
          }
          throw new ServiceUnavailableException({
            error: "Service Unavailable",
          });
        }

        const result = outcome.result;

        if (sendHeaders) {
          setHeaders(response, buildRateLimitHeaders(result));
        }

        if (result.allowed) {
          return true;
        }

        if (options.onLimitReached) {
          await options.onLimitReached(request, response);
          return false;
        }

        throw new HttpException(
          { error: "Too Many Requests" },
          HttpStatus.TOO_MANY_REQUESTS
        );
      }
    }

    return NestGuard;
  };
}

@Module({})
export class LimitlyModule {}

export function limitlyNestModule(
  options: NestRateLimitOptions
): DynamicModule {
  const { limiter, global, ...middlewareOptions } = options;
  const Guard = createNestGuard(limiter)(middlewareOptions);

  return {
    module: LimitlyModule,
    providers: [Guard],
    exports: [Guard],
    global: global ?? false,
  };
}