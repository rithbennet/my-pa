import { z } from "zod";

const envSchema = z.object({
  API_KEY: z.string().min(1, "API_KEY is required"),
  GEMINI_API_KEY: z.string().min(1, "GEMINI_API_KEY is required"),
  NOTION_API_KEY: z.string().min(1, "NOTION_API_KEY is required"),
  NOTION_DATABASE_ID: z.string().min(1, "NOTION_DATABASE_ID is required"),
  PORT: z.coerce.number().int().positive().default(3000),
  CORS_ALLOWED_ORIGINS: z.string().optional(),
  LOG_LEVEL: z.string().default("info"),
});

export const env = envSchema.parse(process.env);

export type Env = typeof env;

