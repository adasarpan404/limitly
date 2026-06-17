import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import type { RedisLimit } from "../limiter";
import type { MiddlewareOptions, MiddlewareOptionsInput } from "../types";
import { buildRateLimitHeaders } from "../utils/headers";
import {
  bindConcurrencyRelease,
  processLimitRequest,
} from "../utils/limit-execution";

const DEFAULT_KEY = (req: FastifyRequest): string => req.ip;

export type FastifyRateLimitOptions = MiddlewareOptionsInput & {
  limiter: RedisLimit;
};

function setFastifyHeaders(
  reply: FastifyReply,
  headers: ReturnType<typeof buildRateLimitHeaders>
): void {
  for (const [name, value] of Object.entries(headers)) {
    if (value !== undefined) {
      reply.header(name, value);
    }
  }
}

export function createFastifyPlugin(
  limiter: RedisLimit
): FastifyPluginAsync<MiddlewareOptionsInput> {
  const plugin: FastifyPluginAsync<MiddlewareOptionsInput> = async (
    fastify,
    options
  ) => {
    const resolved = limiter.resolveOptions(options);
    const strategy = limiter.createStrategy(resolved);
    const keyExtractor = (resolved.key ?? DEFAULT_KEY) as (
      req: FastifyRequest
    ) => string | undefined;
    const sendHeaders = resolved.headers !== false;
    const failOpen = resolved.failOpen ?? true;

    fastify.addHook("preHandler", async (request, reply) => {
      const key = keyExtractor(request) ?? "unknown";
      const outcome = await processLimitRequest({
        limiter,
        strategy,
        key,
        options: resolved,
        failOpen,
        context: request,
      });

      if (outcome.status === "error") {
        if (failOpen) {
          return;
        }
        reply.status(503).send({ error: "Service Unavailable" });
        return;
      }

      if (outcome.status === "blocked") {
        if (sendHeaders) {
          setFastifyHeaders(reply, buildRateLimitHeaders(outcome.result));
        }

        if (resolved.onLimitReached) {
          await resolved.onLimitReached(request, reply);
          return;
        }

        reply.status(429).send({ error: "Too Many Requests" });
        return;
      }

      if (sendHeaders) {
        setFastifyHeaders(reply, buildRateLimitHeaders(outcome.result));
      }

      if (outcome.slotId) {
        bindConcurrencyRelease({
          strategy,
          key,
          slotId: outcome.slotId,
          emitter: reply.raw,
        });
      }
    });
  };

  return plugin;
}

export const redisLimitPlugin: FastifyPluginAsync<FastifyRateLimitOptions> = async (
  fastify,
  options
) => {
  const { limiter, ...rest } = options;
  await fastify.register(createFastifyPlugin(limiter), rest);
};