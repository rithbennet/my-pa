import { z } from "zod";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { createTaskFromText } from "../../../app/useCases/createTaskFromText.ts";
import type { CreatedTask } from "../../../infra/notion/notionTaskRepo.ts";
import { schemas } from "../../../ai/schemas/taskSchemas.ts";

const createdTaskSchema: z.ZodType<CreatedTask> = z.lazy(() =>
  z.object({
    id: z.string(),
    url: z.string(),
    task: schemas.parsedTaskOutputSchema,
    subtasks: z.array(createdTaskSchema),
  })
);

export async function registerTaskRoutes(fastify: FastifyInstance) {
  const typed = fastify.withTypeProvider<ZodTypeProvider>();

  typed.post(
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
      const tasks = await createTaskFromText({ text, source: "http" });
      return { tasks };
    }
  );
}
