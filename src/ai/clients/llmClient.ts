import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { generateObject } from "ai";
import { z } from "zod";
import { env } from "../../infra/config/env.ts";

export type LogicalModel = "cheap" | "smart";

const modelMap: Record<LogicalModel, string> = {
  cheap: "gemini-2.5-flash",
  smart: "gemini-2.5-pro",
};

const google = createGoogleGenerativeAI({
  apiKey: env.GEMINI_API_KEY,
});

export function getModel(model: LogicalModel | string) {
  const modelId =
    model in modelMap ? modelMap[model as LogicalModel] : String(model);
  return google(modelId);
}

export async function callStructuredLLM<T>({
  prompt,
  schema,
  model = "cheap",
}: {
  prompt: string;
  schema: z.ZodTypeAny;
  model?: LogicalModel | string;
}): Promise<T> {
  const { object } = await generateObject({
    model: getModel(model),
    schema,
    prompt,
  });

  return object as T;
}

