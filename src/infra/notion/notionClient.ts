import { Client } from "@notionhq/client";
import { env } from "../config/env.ts";

export const notionClient = new Client({ auth: env.NOTION_API_KEY });

