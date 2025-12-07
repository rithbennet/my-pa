import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { generateObject } from "ai";
import { z } from "zod";
import { env } from "./env.ts";

const priorityValues = ["Low", "Medium", "High", "Urgent"] as const;
const statusValues = ["Not Started", "In Progress", "Blocked", "Done"] as const;
const effortValues = ["S", "M", "L"] as const;

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

const parsedTaskSchema: z.ZodType<ParsedTaskInput> = z.lazy(() =>
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
        z.array(parsedTaskSchema).optional()
      )
      .optional(),
  })
);

const parsedTasksSchema = z.object({
  tasks: z.array(parsedTaskSchema).min(1),
});

const parsedTaskOutputSchema: z.ZodType<ParsedTask> = z.lazy(() =>
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

const google = createGoogleGenerativeAI({
  apiKey: env.GEMINI_API_KEY,
});
const model = google("gemini-2.5-flash");
const todayIsoDate = new Date().toISOString().slice(0, 10); // YYYY-MM-DD reference

const dueDateResolverSchema = z.object({
  dueDate: z.string().datetime().nullable(),
});

type DueDateResolverResult = z.infer<typeof dueDateResolverSchema>;

async function resolveDueDateWithModel(
  text: string
): Promise<string | undefined> {
  const hasDateHint =
    /today|tomorrow|next week|next month|this week|by |due /i.test(text);
  if (!hasDateHint) return undefined;

  const { object } = await generateObject({
    model,
    schema: dueDateResolverSchema,
    prompt: [
      "Extract a clear due date from the text if one is implied or stated.",
      "Return an ISO 8601 string (date or datetime). If no due date is present, return null.",
      `Today's date: ${todayIsoDate}. Use it to resolve relative terms.`,
      "Assume the user's local time; prefer YYYY-MM-DD (no time) when only a day is given.",
      "",
      `Text: ${text}`,
    ].join("\n"),
  });

  const typed = object as DueDateResolverResult;
  return typed.dueDate ?? undefined;
}

async function enrichDueDates(task: ParsedTask): Promise<ParsedTask> {
  const text = [task.title, task.description].filter(Boolean).join(" ");
  const resolvedDue = task.dueDate ?? (await resolveDueDateWithModel(text));
  const subtasks =
    task.subtasks && task.subtasks.length
      ? await Promise.all(task.subtasks.map(enrichDueDates))
      : [];

  return {
    ...task,
    dueDate: normalizeDueDate(resolvedDue),
    subtasks,
  };
}

const applyDefaults = (task: ParsedTaskInput): ParsedTask => {
  return {
    title: task.title,
    description: task.description,
    dueDate: normalizeDueDate(task.dueDate),
    priority: normalizePriority(task.priority),
    status: normalizeStatus(task.status),
    effort: normalizeEffort(task.effort),
    taskType: task.taskType ?? "Task",
    subtasks: (task.subtasks ?? []).map(applyDefaults),
  };
};

function normalizeDueDate(value?: string) {
  if (!value) return undefined;
  const natural = parseNaturalDate(value);
  if (natural) return natural;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return undefined;
  return parsed.toISOString();
}

function parseNaturalDate(value: string): string | undefined {
  const lower = value.toLowerCase().trim();
  const now = new Date();

  const startOfDay = (date: Date) => {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    return d.toISOString();
  };

  if (lower === "today" || lower.includes("by today")) {
    return startOfDay(now);
  }
  if (lower === "tomorrow" || lower.includes("by tomorrow")) {
    const d = new Date(now);
    d.setDate(d.getDate() + 1);
    return startOfDay(d);
  }
  if (lower.includes("next week")) {
    const d = new Date(now);
    d.setDate(d.getDate() + 7);
    return startOfDay(d);
  }
  if (lower.includes("next month")) {
    const d = new Date(now);
    d.setMonth(d.getMonth() + 1);
    return startOfDay(d);
  }
  if (lower.includes("this week")) {
    // Set to end of this week (Sunday)
    const d = new Date(now);
    const day = d.getDay();
    const diff = 7 - day;
    d.setDate(d.getDate() + diff);
    return startOfDay(d);
  }
  return undefined;
}

function normalizePriority(value?: string): Priority {
  const v = value?.toLowerCase().trim();
  if (v === "urgent") return "Urgent";
  if (v === "high") return "High";
  if (v === "medium" || v === "med") return "Medium";
  return "Low";
}

function normalizeStatus(value?: string): Status {
  const v = value?.toLowerCase().trim();
  if (v === "in progress" || v === "doing" || v === "working")
    return "In Progress";
  if (v === "blocked") return "Blocked";
  if (v === "done" || v === "completed" || v === "complete") return "Done";
  return "Not Started";
}

function normalizeEffort(value?: string): Effort {
  const v = value?.toLowerCase().trim();
  if (v === "m" || v === "medium" || v === "med") return "M";
  if (v === "l" || v === "large" || v === "high" || v === "big") return "L";
  return "S";
}

export async function parseTasks(text: string): Promise<ParsedTask[]> {
  const { object } = await generateObject({
    model,
    schema: parsedTasksSchema,
    prompt: [
      "You extract tasks from freeform input.",
      "Return an array of tasks with optional subtasks when a task is complex.",
      "Include concise titles, optional descriptions, and due dates when present.",
      "Infer clear due dates from relative terms (e.g., today, tomorrow, this week) and provide them as ISO dates (YYYY-MM-DD or full ISO).",
      `Today's date (reference for relative terms): ${todayIsoDate}.`,
      "Respect provided priorities/status/effort when explicit; otherwise infer sensible defaults.",
      "If multiple tasks are present, include each separately.",
      "You must return at least one task; never return an empty list.",
      "Respond with JSON only.",
      "",
      `User input: ${text}`,
    ].join("\n"),
  });

  const tasks = object.tasks.length
    ? object.tasks
    : [{ title: text.slice(0, 200), subtasks: [] }];

  const withDefaults = tasks.map(applyDefaults);
  return Promise.all(withDefaults.map(enrichDueDates));
}

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

export const schemas = {
  parsedTaskSchema,
  parsedTasksSchema,
  parsedTaskOutputSchema,
};
