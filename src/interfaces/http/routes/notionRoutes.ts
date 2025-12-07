import { z } from "zod";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import type { FastifyInstance } from "fastify";
import { notionTaskRepo } from "../../../infra/notion/notionTaskRepo.ts";

export async function registerNotionRoutes(fastify: FastifyInstance) {
  const typed = fastify.withTypeProvider<ZodTypeProvider>();

  typed.get(
    "/notion/database",
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
      return notionTaskRepo.getDatabaseInfo();
    }
  );
}
