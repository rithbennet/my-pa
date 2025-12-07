import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import Fastify from "fastify";
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from "fastify-type-provider-zod";
import { z } from "zod";
import { parseTasks, schemas } from "./src/ai.ts";
import { env } from "./src/env.ts";
import {
  createTasks,
  getDatabaseInfo,
  type CreatedTask,
} from "./src/notion.ts";

const createdTaskSchema: z.ZodType<CreatedTask> = z.lazy(() =>
  z.object({
    id: z.string(),
    url: z.string(),
    task: schemas.parsedTaskOutputSchema,
    subtasks: z.array(createdTaskSchema),
  })
);

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

await fastify.register(cors, { origin: true });
await fastify.register(helmet);

fastify.addHook("onRequest", async (request, reply) => {
  if (request.url.startsWith("/health")) return;
  const apiKey = request.headers["x-api-key"];
  if (apiKey !== env.API_KEY) {
    reply.code(401);
    return { error: "unauthorized" };
  }
});

fastify.get("/health", async () => ({ status: "ok" }));

fastify.get(
  "/notion/test",
  {
    schema: {
      response: {
        200: z.object({
          id: z.string(),
          title: z.string().optional(),
          properties: z.array(z.string()),
        }),
      },
    },
  },
  async () => {
    const info = await getDatabaseInfo();
    return info;
  }
);

fastify.post(
  "/task",
  {
    schema: {
      body: z.object({
        text: z.string().min(1, "text is required"),
      }),
      response: {
        200: z.object({
          tasks: z.array(createdTaskSchema),
        }),
      },
    },
  },
  async (request) => {
    const { text } = request.body;
    const parsed = await parseTasks(text);
    const created = await createTasks(parsed);
    return { tasks: created };
  }
);

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

const port = env.PORT ?? 3000;

const start = async () => {
  try {
    await fastify.listen({ port, host: "0.0.0.0" });
    fastify.log.info({ port }, "server started");
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

await start();
