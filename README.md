# Backend Task Capture (Fastify + Bun)

## Setup

1) Install deps (Bun):
```bash
bun install
```

2) Copy env and fill values:
```bash
cp env.example .env
```
Required keys:
- `API_KEY` – shared secret for `x-api-key`
- `GEMINI_API_KEY` – Google Gemini API key (for Vercel AI SDK)
- `NOTION_API_KEY` – Notion integration secret
- `NOTION_DATABASE_ID` – tasks database ID (provided)
- `PORT` (optional, default 3000)

3) Run the server:
```bash
bun run index.ts
```

## Routes
- `GET /health` – unauthenticated status check
- `GET /notion/database` – authenticated, returns Notion DB metadata
- `POST /task` – authenticated with `x-api-key`
  - body: `{ "text": "freeform task(s)" }`
  - behavior: parses multiple tasks + subtasks via Gemini, writes pages to Notion, returns created task metadata (Notion IDs/URLs plus parsed task data).

## Notes on parsing & Notion mapping
- Defaults: `priority=Low`, `status=Not Started`, `effort=S`, `taskType=Task` when not specified.
- The parser infers due dates when present; invalid or missing dates are omitted.
- Select options (`Status`, `Priority`, `Task type`, `Effort level`) are created on-the-fly in the Notion database if missing.
- Subtasks are related to their parent if a relation property (e.g., `Parent task`) exists in the database.

## Architecture
- `interfaces/http` – Fastify setup and routes (`/task`, `/health`, `/notion/database`)
- `app/useCases` – orchestration (`createTaskFromText`)
- `ai` – schemas, prompts, pipelines, and LLM client
- `infra` – env config, Notion client/repo, logging

## Example prompt styles
- Multiple tasks: `"Plan Q1 roadmap; Prepare board deck; Fix login bug"`
- Subtasks: `"Ship onboarding revamp: update docs, record loom, notify CS by Friday"`
