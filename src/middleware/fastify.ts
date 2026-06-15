import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import type { RedisLimit } from "../limiter";
import type { MiddlewareOptions } from "../types";
import { buildRateLimitHeaders } from "../utils/headers";

const DEFAULT_KEY = (req: FastifyRequest): string => req.ip;

export type FastifyRateLimitOptions = MiddlewareOptions & {
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

export function createFastifyPlugin(limiter: RedisLimit): FastifyPluginAsync<MiddlewareOptions> {
  const plugin: FastifyPluginAsync<MiddlewareOptions> = async (fastify, options) => {
    const strategy = limiter.createStrategy(options);
    const keyExtractor = (options.key ?? DEFAULT_KEY) as (
      req: FastifyRequest
    ) => string | undefined;
    const sendHeaders = options.headers !== false;
    const failOpen = options.failOpen ?? true;

    fastify.addHook("preHandler", async (request, reply) => {
      const key = keyExtractor(request) ?? "unknown";

      let result;
      try {
        result = await strategy.consume(key);
      } catch {
        if (failOpen) {
          return;
        }
        reply.status(503).send({ error: "Service Unavailable" });
        return;
      }

      if (sendHeaders) {
        setFastifyHeaders(reply, buildRateLimitHeaders(result));
      }

      if (!result.allowed) {
        if (options.onLimitReached) {
          await options.onLimitReached(request, reply);
          return;
        }

        reply.status(429).send({ error: "Too Many Requests" });
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
  const middlewareOptions = rest as MiddlewareOptions;
  await fastify.register(createFastifyPlugin(limiter), middlewareOptions);
};