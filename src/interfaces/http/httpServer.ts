import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import Fastify from "fastify";
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from "fastify-type-provider-zod";
import { env } from "../../infra/config/env.ts";
import { registerHealthRoutes } from "./routes/healthRoutes.ts";
import { registerTaskRoutes } from "./routes/taskRoutes.ts";
import { registerNotionRoutes } from "./routes/notionRoutes.ts";

export async function buildHttpServer() {
  const fastify = Fastify({
    logger: {
      level: "info",
      transport: {
        target: "pino-pretty",
        options: {
          colorize: true,
          translateTime: "SYS:standard",
          ignore: "pid,hostname",
          singleLine: false,
        },
      },
    },
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
      reply.code(401);
      return { error: "unauthorized" };
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
