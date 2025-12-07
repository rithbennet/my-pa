import { z } from "zod";
import { callStructuredLLM } from "../clients/llmClient.ts";
import { buildTaskParsingPrompt } from "../prompts/taskParsingPrompt.ts";
import {
  effortValues,
  ParsedTask,
  ParsedTaskInput,
  parsedTasksSchema,
  priorityValues,
  schemas,
  statusValues,
} from "../schemas/taskSchemas.ts";

const todayIsoDate = new Date().toISOString().slice(0, 10); // YYYY-MM-DD reference

const dueDateResolverSchema = z.object({
  dueDate: z.string().datetime().nullable(),
});

type DueDateResolverResult = z.infer<typeof dueDateResolverSchema>;

export async function runTaskParsingPipeline(
  text: string
): Promise<ParsedTask[]> {
  const prompt = buildTaskParsingPrompt(todayIsoDate, text);
  const { tasks } = await callStructuredLLM<{ tasks: ParsedTaskInput[] }>({
    prompt,
    schema: parsedTasksSchema,
    model: "cheap",
  });

  const safeTasks = tasks.length
    ? tasks
    : [
        {
          title: text.slice(0, 200) || "Untitled task",
          subtasks: [],
        },
      ];

  const withDefaults = safeTasks.map(applyDefaults);
  return Promise.all(withDefaults.map(enrichDueDates));
}

async function resolveDueDateWithModel(
  text: string
): Promise<string | undefined> {
  const hasDateHint =
    /today|tomorrow|next week|next month|this week|by |due /i.test(text);
  if (!hasDateHint) return undefined;

  const { dueDate } = await callStructuredLLM<DueDateResolverResult>({
    model: "cheap",
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

  return dueDate ?? undefined;
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

function normalizePriority(value?: string) {
  const v = value?.toLowerCase().trim();
  if (v === "urgent") return priorityValues[3];
  if (v === "high") return priorityValues[2];
  if (v === "medium" || v === "med") return priorityValues[1];
  return priorityValues[0];
}

function normalizeStatus(value?: string) {
  const v = value?.toLowerCase().trim();
  if (v === "in progress" || v === "doing" || v === "working")
    return statusValues[1];
  if (v === "blocked") return statusValues[2];
  if (v === "done" || v === "completed" || v === "complete")
    return statusValues[3];
  return statusValues[0];
}

function normalizeEffort(value?: string) {
  const v = value?.toLowerCase().trim();
  if (v === "m" || v === "medium" || v === "med") return effortValues[1];
  if (v === "l" || v === "large" || v === "high" || v === "big")
    return effortValues[2];
  return effortValues[0];
}

export const taskPipelineSchemas = schemas;

