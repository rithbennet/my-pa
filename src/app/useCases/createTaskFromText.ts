import { runTaskParsingPipeline } from "../../ai/pipelines/taskPipeline.ts";
import type { ParsedTask } from "../../ai/schemas/taskSchemas.ts";
import {
  notionTaskRepo,
  type CreatedTask,
} from "../../infra/notion/notionTaskRepo.ts";

export type CreateTaskFromTextInput = {
  text: string;
  source: string;
};

export type CreateTaskFromTextResult = CreatedTask[];

export async function createTaskFromText({
  text,
  source,
}: CreateTaskFromTextInput): Promise<CreateTaskFromTextResult> {
  const parsedTasks: ParsedTask[] = await runTaskParsingPipeline(text);
  return notionTaskRepo.createFromParsedTasks(parsedTasks, { source });
}

