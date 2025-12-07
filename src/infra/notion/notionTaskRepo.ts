import type { ParsedTask } from "../../ai/schemas/taskSchemas.ts";
import { env } from "../config/env.ts";
import { notionClient } from "./notionClient.ts";

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

export type CreatedTask = {
  id: string;
  url: string;
  task: ParsedTask;
  subtasks: CreatedTask[];
};

export type CreateTaskOptions = {
  source?: string;
};

class NotionTaskRepo {
  private cachedProperties: DatabaseProperties | null = null;
  private parentRelationProperty: string | null = null;
  private normalizedPropertyNames: Record<string, string> = {};

  async getDatabaseInfo() {
    const db = await notionClient.databases.retrieve({
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

  async createFromParsedTasks(
    tasks: ParsedTask[],
    options?: CreateTaskOptions
  ): Promise<CreatedTask[]> {
    await this.ensureMetadata();
    const results: CreatedTask[] = [];
    for (const task of tasks) {
      results.push(await this.createTask(task, null, options));
    }
    return results;
  }

  private async createTask(
    task: ParsedTask,
    parentPageId: string | null,
    options?: CreateTaskOptions
  ): Promise<CreatedTask> {
    const statusType = this.getPropertyType("Status");
    const priorityType = this.getPropertyType("Priority");
    const taskTypeType = this.getPropertyType("Task type");
    const effortType = this.getPropertyType("Effort level");
    const sourceType = this.getPropertyType("Source");

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

    const status = await this.ensureSelectOption("Status", task.status);
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

    const priority = await this.ensureSelectOption("Priority", task.priority);
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

    const taskType = await this.ensureSelectOption("Task type", task.taskType);
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

    const effort = await this.ensureSelectOption("Effort level", task.effort);
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

    if (options?.source) {
      const sourceKey = this.resolvePropertyName("Source");
      if (sourceKey?.property.type === "multi_select") {
        properties[sourceKey.name] = {
          multi_select: [{ name: options.source }],
        };
      } else if (sourceKey?.property.type === "select") {
        properties[sourceKey.name] = { select: { name: options.source } };
      } else if (sourceKey?.property.type === "status") {
        properties[sourceKey.name] = { status: { name: options.source } };
      } else if (sourceType === "multi_select") {
        properties["Source"] = { multi_select: [{ name: options.source }] };
      } else if (sourceType === "select") {
        properties["Source"] = { select: { name: options.source } };
      } else if (sourceType === "status") {
        properties["Source"] = { status: { name: options.source } };
      } else {
        properties["Source"] = {
          rich_text: [{ text: { content: options.source } }],
        };
      }
    }

    if (task.dueDate) {
      properties["Due date"] = { date: { start: task.dueDate } };
    }

    if (parentPageId && this.parentRelationProperty) {
      properties[this.parentRelationProperty] = {
        relation: [{ id: parentPageId }],
      };
    }

    const page = await notionClient.pages.create({
      parent: { database_id: env.NOTION_DATABASE_ID },
      properties: properties as any,
    });

    const children: CreatedTask[] = [];
    for (const child of task.subtasks ?? []) {
      children.push(await this.createTask(child, page.id, options));
    }

    const pageUrl =
      "url" in page && typeof page.url === "string" ? page.url : "";

    return {
      id: page.id,
      url: pageUrl,
      task,
      subtasks: children,
    };
  }

  private findRelationProperty(properties: DatabaseProperties): string | null {
    const candidates = ["Parent task", "Parent Task", "Parent"];
    for (const name of candidates) {
      const prop = properties[name];
      if (prop && prop.type === "relation") return name;
    }
    return null;
  }

  private async ensureMetadata() {
    if (this.cachedProperties) return this.cachedProperties;
    const db = await notionClient.databases.retrieve({
      database_id: env.NOTION_DATABASE_ID,
    });
    const properties = (db as { properties?: DatabaseProperties }).properties;
    if (!properties) {
      this.cachedProperties = {};
      this.parentRelationProperty = null;
      this.normalizedPropertyNames = {};
      return this.cachedProperties;
    }
    this.cachedProperties = properties;
    this.normalizedPropertyNames = Object.keys(properties).reduce<
      Record<string, string>
    >((acc, key) => {
      acc[this.normalizePropertyKey(key)] = key;
      return acc;
    }, {});
    this.parentRelationProperty = this.findRelationProperty(properties);
    return this.cachedProperties;
  }

  private normalizePropertyKey(name: string): string {
    return name
      .toLowerCase()
      .replace(/[\s_-]+/g, "")
      .replace(/[^\p{L}\p{N}]+/gu, "")
      .trim();
  }

  private resolvePropertyName(
    desiredName: string
  ): { name: string; property: DatabaseProperty } | null {
    const normalized = this.normalizePropertyKey(desiredName);
    const matchedName = this.normalizedPropertyNames[normalized] ?? null;
    if (matchedName && this.cachedProperties?.[matchedName]) {
      return {
        name: matchedName,
        property: this.cachedProperties[matchedName]!,
      };
    }

    // Fallback: try partial match on normalized key
    const partialMatch = Object.entries(this.normalizedPropertyNames).find(
      ([norm]) => norm.includes(normalized) || normalized.includes(norm)
    );
    if (partialMatch) {
      const [, originalName] = partialMatch;
      const property = this.cachedProperties?.[originalName];
      if (property) return { name: originalName, property };
    }

    return null;
  }

  private getPropertyType(
    propName: string
  ): DatabaseProperty["type"] | undefined {
    const resolved = this.resolvePropertyName(propName);
    return resolved?.property.type;
  }

  private fallbackPropertyByType(
    desiredType: DatabaseProperty["type"]
  ): { name: string; property: DatabaseProperty } | null {
    if (!this.cachedProperties) return null;
    const entries = Object.entries(this.cachedProperties).filter(
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

  private async ensureSelectOption(
    propName: string,
    optionName?: string
  ): Promise<{
    name?: string;
    propertyName?: string;
    propertyType?: DatabaseProperty["type"];
  }> {
    if (!optionName) return {};
    await this.ensureMetadata();
    let resolved = this.resolvePropertyName(propName);
    if (!resolved) {
      // If not found by name, but there's exactly one property of the needed type,
      // try type-based fallback.
      const desiredType = propName.toLowerCase().includes("status")
        ? "status"
        : propName.toLowerCase().includes("type")
        ? "multi_select"
        : undefined;
      if (desiredType) {
        resolved = this.fallbackPropertyByType(desiredType);
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

    const updated = await notionClient.databases.update({
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
      this.cachedProperties = updatedProps;
      this.normalizedPropertyNames = Object.keys(updatedProps).reduce<
        Record<string, string>
      >((acc, key) => {
        acc[this.normalizePropertyKey(key)] = key;
        return acc;
      }, {});
    }
    return {
      name: optionName,
      propertyName: resolvedName,
      propertyType: property.type,
    };
  }
}

export const notionTaskRepo = new NotionTaskRepo();
