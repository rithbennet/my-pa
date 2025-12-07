import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import Fastify from "fastify";
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from "fastify-type-provider-zod";
import { env } from "@/infra/config/env.ts";
import { registerHealthRoutes } from "./routes/healthRoutes.ts";
import { registerTaskRoutes } from "./routes/taskRoutes.ts";
import { registerNotionRoutes } from "./routes/notionRoutes.ts";
import { loggerOptions } from "@/infra/logging/logger.ts";

export async function buildHttpServer() {
  const fastify = Fastify({
    // Fastify expects a logger options object or instance; pass options to let it build its own logger.
    logger: loggerOptions,
  }).withTypeProvider<ZodTypeProvider>();

  fastify.setValidatorCompiler(validatorCompiler);
  fastify.setSerializerCompiler(serializerCompiler);

  // Configure CORS with an allowlist from environment variable
  const allowedOrigins = (env.CORS_ALLOWED_ORIGINS || "")
    .split(",")
    .map(origin => origin.trim())
    .filter(Boolean);

  await fastify.register(cors, {
    origin: (origin, cb) => {
      // Allow requests with no origin (like mobile apps or curl)
      if (!origin) return cb(null, true);
      if (allowedOrigins.includes(origin)) {
        cb(null, true);
      } else {
        cb(new Error("Not allowed by CORS"), false);
      }
    }
  });
  await fastify.register(helmet);

  fastify.addHook("onRequest", async (request, reply) => {
    if (request.url.startsWith("/health")) return;
    const apiKey = request.headers["x-api-key"];
    if (apiKey !== env.API_KEY) {
      return reply.code(401).send({ error: "unauthorized" });
    }
  });

  await registerHealthRoutes(fastify);
  await registerTaskRoutes(fastify);
  await registerNotionRoutes(fastify);

  fastify.setErrorHandler((error, request, reply) => {
    request.log.error({ err: error }, "request failed");
    const status = (error as { statusCode?: number }).statusCode ?? 500;
    const message =
      error instanceof Error ? error.message : "Unexpected error occurred";
    reply.status(status).send({
      error: "internal_error",
      message,
    });
  });

  return fastify;
}
