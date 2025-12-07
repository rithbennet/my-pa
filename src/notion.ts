import {
  notionTaskRepo,
  type CreatedTask,
  type CreateTaskOptions,
} from "./infra/notion/notionTaskRepo.ts";

export { notionTaskRepo, type CreatedTask, type CreateTaskOptions };

export const createTasks =
  notionTaskRepo.createFromParsedTasks.bind(notionTaskRepo);
export const getDatabaseInfo =
  notionTaskRepo.getDatabaseInfo.bind(notionTaskRepo);
