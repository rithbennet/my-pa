import { Client } from "@notionhq/client";
import { env } from "./env.ts";
import type { ParsedTask } from "./ai.ts";

const notion = new Client({ auth: env.NOTION_API_KEY });

type SelectOption = { name: string };
type SelectLikeOptions = { options?: SelectOption[] };
type SelectProperty = { type: "select"; select?: SelectLikeOptions };
type MultiSelectProperty = {
  type: "multi_select";
  multi_select?: SelectLikeOptions;
};
type StatusProperty = { type: "status"; status?: SelectLikeOptions };
type RelationProperty = { type: "relation" };
type DatabaseProperty = (
  | SelectProperty
  | MultiSelectProperty
  | StatusProperty
  | RelationProperty
  | { type: string }
) & {
  [key: string]: unknown;
};
type DatabaseProperties = Record<string, DatabaseProperty>;

let cachedProperties: DatabaseProperties | null = null;
let parentRelationProperty: string | null = null;
let normalizedPropertyNames: Record<string, string> = {};

function findRelationProperty(properties: DatabaseProperties): string | null {
  const candidates = ["Parent task", "Parent Task", "Parent"];
  for (const name of candidates) {
    const prop = properties[name];
    if (prop && prop.type === "relation") return name;
  }
  return null;
}

async function ensureMetadata() {
  if (cachedProperties) return cachedProperties;
  const db = await notion.databases.retrieve({
    database_id: env.NOTION_DATABASE_ID,
  });
  const properties = (db as { properties?: DatabaseProperties }).properties;
  if (!properties) {
    cachedProperties = {};
    parentRelationProperty = null;
    normalizedPropertyNames = {};
    return cachedProperties;
  }
  cachedProperties = properties;
  normalizedPropertyNames = Object.keys(properties).reduce<
    Record<string, string>
  >((acc, key) => {
    acc[normalizePropertyKey(key)] = key;
    return acc;
  }, {});
  parentRelationProperty = findRelationProperty(properties);
  return cachedProperties;
}

function normalizePropertyKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/[\s_-]+/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, "")
    .trim();
}

function resolvePropertyName(
  desiredName: string
): { name: string; property: DatabaseProperty } | null {
  const normalized = normalizePropertyKey(desiredName);
  const matchedName = normalizedPropertyNames[normalized] ?? null;
  if (matchedName && cachedProperties?.[matchedName]) {
    return { name: matchedName, property: cachedProperties[matchedName]! };
  }

  // Fallback: try partial match on normalized key
  const partialMatch = Object.entries(normalizedPropertyNames).find(
    ([norm]) => norm.includes(normalized) || normalized.includes(norm)
  );
  if (partialMatch) {
    const [, originalName] = partialMatch;
    const property = cachedProperties?.[originalName];
    if (property) return { name: originalName, property };
  }

  return null;
}

function getPropertyType(
  propName: string
): DatabaseProperty["type"] | undefined {
  const resolved = resolvePropertyName(propName);
  return resolved?.property.type;
}

type SelectOptionResult = {
  name?: string;
  propertyName?: string;
  propertyType?: DatabaseProperty["type"];
};

function fallbackPropertyByType(
  desiredType: DatabaseProperty["type"]
): { name: string; property: DatabaseProperty } | null {
  if (!cachedProperties) return null;
  const entries = Object.entries(cachedProperties).filter(
    ([, prop]) => prop.type === desiredType
  );
  if (entries.length === 1) {
    const entry = entries[0];
    if (entry) {
      const [name, property] = entry;
      return { name, property };
    }
  }
  return null;
}

async function ensureSelectOption(
  propName: string,
  optionName?: string
): Promise<SelectOptionResult> {
  if (!optionName) return {};
  const properties = await ensureMetadata();
  let resolved = resolvePropertyName(propName);
  if (!resolved) {
    // If not found by name, but there's exactly one property of the needed type,
    // try type-based fallback.
    const desiredType = propName.toLowerCase().includes("status")
      ? "status"
      : propName.toLowerCase().includes("type")
      ? "multi_select"
      : undefined;
    if (desiredType) {
      resolved = fallbackPropertyByType(desiredType);
    }
  }
  if (!resolved) return { name: optionName };
  const { name: resolvedName, property } = resolved;

  if (
    property.type !== "select" &&
    property.type !== "multi_select" &&
    property.type !== "status"
  ) {
    return {
      name: optionName,
      propertyName: resolvedName,
      propertyType: property.type,
    };
  }

  const options: SelectOption[] =
    property.type === "select"
      ? (property as SelectProperty).select?.options ?? []
      : property.type === "multi_select"
      ? (property as MultiSelectProperty).multi_select?.options ?? []
      : (property as StatusProperty).status?.options ?? [];

  if (options.some((opt) => opt.name === optionName))
    return {
      name: optionName,
      propertyName: resolvedName,
      propertyType: property.type,
    };

  // Avoid trying to mutate status options; Notion restricts status option updates.
  if (property.type === "status") {
    return {
      name: optionName,
      propertyName: resolvedName,
      propertyType: property.type,
    };
  }

  const updated = await notion.databases.update({
    database_id: env.NOTION_DATABASE_ID,
    properties: {
      [resolvedName]: {
        [property.type]: {
          options: [...options, { name: optionName }],
        },
      },
    },
  } as any);

  const updatedProps = (updated as { properties?: DatabaseProperties })
    .properties;
  if (updatedProps) {
    cachedProperties = updatedProps;
    normalizedPropertyNames = Object.keys(updatedProps).reduce<
      Record<string, string>
    >((acc, key) => {
      acc[normalizePropertyKey(key)] = key;
      return acc;
    }, {});
  }
  return {
    name: optionName,
    propertyName: resolvedName,
    propertyType: property.type,
  };
}

export type CreatedTask = {
  id: string;
  url: string;
  task: ParsedTask;
  subtasks: CreatedTask[];
};

export async function getDatabaseInfo() {
  const db = await notion.databases.retrieve({
    database_id: env.NOTION_DATABASE_ID,
  });
  const title =
    Array.isArray((db as { title?: Array<{ plain_text?: string }> }).title) &&
    (db as { title?: Array<{ plain_text?: string }> }).title
      ?.map((t) => t.plain_text ?? "")
      .join("")
      .trim();
  const properties = Object.keys(
    (db as { properties?: DatabaseProperties }).properties ?? {}
  );
  return {
    id: env.NOTION_DATABASE_ID,
    title: title || undefined,
    properties,
  };
}

export async function createTasks(tasks: ParsedTask[]): Promise<CreatedTask[]> {
  await ensureMetadata();
  const results: CreatedTask[] = [];
  for (const task of tasks) {
    results.push(await createTask(task, null));
  }
  return results;
}

async function createTask(
  task: ParsedTask,
  parentPageId: string | null
): Promise<CreatedTask> {
  const statusType = getPropertyType("Status");
  const priorityType = getPropertyType("Priority");
  const taskTypeType = getPropertyType("Task type");
  const effortType = getPropertyType("Effort level");

  const defaultTypeFor = (
    name: string
  ): DatabaseProperty["type"] | undefined => {
    const n = name.toLowerCase();
    if (n.includes("status")) return "status";
    if (n.includes("type")) return "multi_select";
    return undefined;
  };

  const properties: Record<string, any> = {
    "Task name": {
      title: [{ text: { content: task.title.slice(0, 2000) } }],
    },
  };

  if (task.description) {
    properties["Description"] = {
      rich_text: [{ text: { content: task.description.slice(0, 2000) } }],
    };
  }

  const status = await ensureSelectOption("Status", task.status);
  if (status.name) {
    const key = status.propertyName ?? "Status";
    const type = status.propertyType ?? statusType ?? defaultTypeFor(key);
    if (type === "multi_select") {
      properties[key] = { multi_select: [{ name: status.name }] };
    } else if (type === "status") {
      properties[key] = { status: { name: status.name } };
    } else {
      properties[key] = { select: { name: status.name } };
    }
  }

  const priority = await ensureSelectOption("Priority", task.priority);
  if (priority.name) {
    const key = priority.propertyName ?? "Priority";
    const type = priority.propertyType ?? priorityType ?? defaultTypeFor(key);
    if (type === "multi_select") {
      properties[key] = { multi_select: [{ name: priority.name }] };
    } else if (type === "status") {
      properties[key] = { status: { name: priority.name } };
    } else {
      properties[key] = { select: { name: priority.name } };
    }
  }

  const taskType = await ensureSelectOption("Task type", task.taskType);
  if (taskType.name) {
    const key = taskType.propertyName ?? "Task type";
    const type = taskType.propertyType ?? taskTypeType ?? defaultTypeFor(key);
    if (type === "multi_select") {
      properties[key] = { multi_select: [{ name: taskType.name }] };
    } else if (type === "status") {
      properties[key] = { status: { name: taskType.name } };
    } else {
      properties[key] = { select: { name: taskType.name } };
    }
  }

  const effort = await ensureSelectOption("Effort level", task.effort);
  if (effort.name) {
    const key = effort.propertyName ?? "Effort level";
    const type = effort.propertyType ?? effortType ?? defaultTypeFor(key);
    if (type === "multi_select") {
      properties[key] = { multi_select: [{ name: effort.name }] };
    } else if (type === "status") {
      properties[key] = { status: { name: effort.name } };
    } else {
      properties[key] = { select: { name: effort.name } };
    }
  }

  if (task.dueDate) {
    properties["Due date"] = { date: { start: task.dueDate } };
  }

  if (parentPageId && parentRelationProperty) {
    properties[parentRelationProperty] = { relation: [{ id: parentPageId }] };
  }

  const page = await notion.pages.create({
    parent: { database_id: env.NOTION_DATABASE_ID },
    properties: properties as any,
  });

  const children: CreatedTask[] = [];
  for (const child of task.subtasks ?? []) {
    children.push(await createTask(child, page.id));
  }

  const pageUrl = "url" in page && typeof page.url === "string" ? page.url : "";

  return {
    id: page.id,
    url: pageUrl,
    task,
    subtasks: children,
  };
}
