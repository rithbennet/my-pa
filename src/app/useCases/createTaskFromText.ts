import { runTaskParsingPipeline } from "@/ai/pipelines/taskPipeline.ts";
import type { ParsedTask } from "@/ai/schemas/taskSchemas.ts";
import {
  notionTaskRepo,
  type CreatedTask,
} from "@/infra/notion/notionTaskRepo.ts";
import { logger } from "@/infra/logging/logger.ts";

export type CreateTaskFromTextInput = {
  text: string;
  source: string;
};

export type CreateTaskFromTextResult = CreatedTask[];

const log = logger.child({ module: "useCase:createTaskFromText" });

export async function createTaskFromText({
  text,
  source,
}: CreateTaskFromTextInput): Promise<CreateTaskFromTextResult> {
  log.info({ source, textLength: text.length }, "parsing tasks from text");
  const parsedTasks: ParsedTask[] = await runTaskParsingPipeline(text);
  log.info({ source, parsedCount: parsedTasks.length }, "parsed tasks");
  const created = await notionTaskRepo.createFromParsedTasks(parsedTasks, {
    source,
  });
  log.info(
    { source, createdCount: created.length },
    "created tasks in notion"
  );
  return created;
}

