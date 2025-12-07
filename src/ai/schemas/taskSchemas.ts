import { z } from "zod";

export const priorityValues = ["Low", "Medium", "High", "Urgent"] as const;
export const statusValues = [
  "Not Started",
  "In Progress",
  "Blocked",
  "Done",
] as const;
export const effortValues = ["S", "M", "L"] as const;

export type Priority = (typeof priorityValues)[number];
export type Status = (typeof statusValues)[number];
export type Effort = (typeof effortValues)[number];

export type ParsedTaskInput = {
  title: string;
  description?: string;
  dueDate?: string;
  priority?: string;
  status?: string;
  effort?: string;
  taskType?: string;
  subtasks?: ParsedTaskInput[];
};

export type ParsedTask = {
  title: string;
  description?: string;
  dueDate?: string;
  priority?: Priority;
  status?: Status;
  effort?: Effort;
  taskType?: string;
  subtasks?: ParsedTask[];
};

const toOptionalString = z.preprocess(
  (v) => (v == null ? undefined : v),
  z.string().optional()
);

function normalizeSubtaskInputs(value: unknown): ParsedTaskInput[] | undefined {
  if (!Array.isArray(value)) return undefined;

  const cleaned: ParsedTaskInput[] = [];
  for (const item of value) {
    if (typeof item === "string") {
      cleaned.push({ title: item });
      continue;
    }
    if (item && typeof item === "object") {
      const obj = item as ParsedTaskInput & { [key: string]: unknown };
      const title =
        typeof obj.title === "string" && obj.title.trim().length
          ? obj.title
          : undefined;
      const subtasks = normalizeSubtaskInputs(obj.subtasks);
      if (title) {
        cleaned.push({
          ...obj,
          title,
          subtasks: subtasks ?? obj.subtasks,
        });
        continue;
      }
    }
    cleaned.push({ title: String(item ?? "").trim() || "Untitled subtask" });
  }

  return cleaned;
}

export const parsedTaskInputSchema: z.ZodType<ParsedTaskInput> = z.lazy(() =>
  z.object({
    title: z.string(),
    description: toOptionalString,
    dueDate: toOptionalString,
    priority: toOptionalString,
    status: toOptionalString,
    effort: toOptionalString,
    taskType: toOptionalString,
    subtasks: z
      .preprocess(
        (value) => normalizeSubtaskInputs(value),
        z.array(parsedTaskInputSchema).optional()
      )
      .optional(),
  })
);

export const parsedTasksSchema = z.object({
  tasks: z.array(parsedTaskInputSchema).min(1),
});

export const parsedTaskOutputSchema: z.ZodType<ParsedTask> = z.lazy(() =>
  z.object({
    title: z.string(),
    description: z.string().optional(),
    dueDate: z.string().optional(),
    priority: z.enum(priorityValues).optional(),
    status: z.enum(statusValues).optional(),
    effort: z.enum(effortValues).optional(),
    taskType: z.string().optional(),
    subtasks: z.array(parsedTaskOutputSchema).optional(),
  })
);

export const schemas = {
  parsedTaskInputSchema,
  parsedTasksSchema,
  parsedTaskOutputSchema,
};
