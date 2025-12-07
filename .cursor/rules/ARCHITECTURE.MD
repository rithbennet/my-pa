# Architecture Overview

This document describes the architecture for your personal AI task assistant, designed for clean separation of concerns (SoC) and future expansion (projects, scheduling, summaries, etc.).

Stack assumptions:

- Backend: Fastify on Railway
- AI: Vercel AI SDK (multiple models behind one abstraction)
- Storage/UI: Notion (Tasks DB now; Projects/Schedule later)
- Auth: simple API key for your backend
- Commands (initially): `/task` (capture); later `/schedule`, `/project`

---

## 1. High-Level Layers

The backend is split into four main layers:

1. **Interface Layer (HTTP)**  
   Fastify routes, request/response mapping, API key auth.

2. **Application Layer (Use-Cases / Command Services)**  
   Orchestrates business logic. Knows about “tasks”, “projects”, “scheduling”, not about prompts or models.

3. **AI Layer (Prompts, Schemas, Pipelines)**  
   Encapsulates all LLM-related logic: prompts, schemas, model choices, pipelines.

4. **Infrastructure Layer (Integrations / Config / Logging)**  
   Notion repos, DB/logging, Vercel AI SDK client, env configuration.

Each layer depends only on lower layers (Interface → Application → AI/Infra).

---

## 2. Folder Structure

A suggested folder layout:

```text
src/
  interfaces/
    http/
      routes/
        taskRoutes.ts
        scheduleRoutes.ts
        projectRoutes.ts
      httpServer.ts          // Fastify setup

  app/
    useCases/
      createTaskFromText.ts
      scheduleTaskFromText.ts
      populateProjectFromText.ts
      // future: updateProjectFromCommand.ts, summarizeDay.ts
    commands/
      // optional: if you later centralize command parsing (/task, /schedule flags)

  ai/
    schemas/
      taskSchemas.ts         // ParsedTask, etc.
      scheduleSchemas.ts     // ParsedScheduleCommand, etc.
      projectSchemas.ts      // ParsedProject, ParsedProjectTask, etc.
    prompts/
      taskParsingPrompt.ts
      schedulePrompt.ts
      projectPrompt.ts
      summaryPrompt.ts
    clients/
      llmClient.ts           // Vercel AI SDK integration + model routing
      modelConfig.ts         // logical → physical model mapping
    pipelines/
      taskPipeline.ts        // text → ParsedTask
      schedulePipeline.ts    // text → ParsedScheduleCommand
      projectPipeline.ts     // text → ParsedProject
      summaryPipeline.ts     // tasks → summary

  infra/
    notion/
      notionClient.ts        // wraps official Notion SDK
      notionTaskRepo.ts      // CRUD for Tasks DB
      notionProjectRepo.ts   // CRUD for Projects DB
      // future: notionScheduleRepo.ts
    db/
      pgClient.ts            // optional: Postgres client (logs, metrics)
      commandLogRepo.ts      // log raw text + parsed JSON + status
    config/
      env.ts                 // env loading, typings for keys/URLs
    logging/
      logger.ts              // centralized logging utility

  index.ts                    // app bootstrap
```

You can start with just the `/task` slice and add `/schedule` and `/project` later in the same pattern.

---

## 3. Core Data Types

### 3.1. Parsed Task (AI output)

Defined in `ai/schemas/taskSchemas.ts`:

- `ParsedTask` is the structure produced by the AI task parser and consumed by application logic.

Shape (conceptual):

```ts
type ParsedTask = {
  title: string;
  description?: string;
  due_iso?: string | null; // ISO8601 datetime in your timezone, or null
  priority?: "low" | "medium" | "high";
};
```

This is validated with Zod (or similar) in the AI layer.

### 3.2. Domain Task (stored in Notion)

The application/infra layers work with a `Task` domain type, mapping closely to Notion:

```ts
type Task = {
  id: string;
  title: string;
  status: "Todo" | "Doing" | "Done";
  due?: string | null;        // ISO8601 or null
  priority?: "Low" | "Medium" | "High";
  source?: string;            // e.g., "backend-task-api", "whatsapp", etc.
};
```

`notionTaskRepo` handles mapping `ParsedTask` → Notion properties → `Task`.

---

## 4. Layer Responsibilities

### 4.1. Interface Layer (HTTP / Fastify)

**Responsibility:** Handle HTTP transport, auth, and map requests/responses into use-case calls.

Example: `interfaces/http/routes/taskRoutes.ts`:

- `POST /task`
  - Validates JSON body `{ text: string }`.
  - Checks API key from `x-api-key`.
  - Calls `createTaskFromText({ text, source: "http" })`.
  - Returns created `Task` as JSON.

No prompts, no LLM models, no Notion details here.

---

### 4.2. Application Layer (Use-Cases)

**Responsibility:** Orchestrate actual business operations.

Examples:

#### `createTaskFromText.ts`

- Input: `{ text: string; source: string }`
- Steps:
  1. Call AI pipeline: `runTaskParsingPipeline(text)` → `ParsedTask`.
  2. Call Notion repo: `notionTaskRepo.createFromParsedTask(parsedTask, source)` → `Task`.
  3. Optionally log command via `commandLogRepo`.
  4. Return `Task`.

This use-case knows:

- “We take user text, parse it, then store a task in Notion.”
- It does **not** know:
  - Which model is used.
  - How the prompt is written.
  - How HTTP worked.

Other use-cases later:

- `scheduleTaskFromText`  
- `populateProjectFromText`  
- `summarizeDay`  

Each uses corresponding AI pipelines + repos.

---

### 4.3. AI Layer (Prompts / Schemas / Pipelines)

This is where all AI behavior is controlled.

#### 4.3.1. Schemas

Each AI pipeline has a strongly-typed schema.

Example: `ai/schemas/taskSchemas.ts`:

- `ParsedTaskSchema` (Zod / JSON schema)
- `ParsedTask` (TS inferred type)

Similarly:

- `scheduleSchemas.ts` → `ParsedScheduleCommand`
- `projectSchemas.ts` → `ParsedProject`, `ParsedProjectTask`

#### 4.3.2. Prompts

Each capability gets its own system prompt.

Example: `ai/prompts/taskParsingPrompt.ts`:

- `taskParsingSystemPrompt` describing how to convert user text into `ParsedTask`.

Later:

- `schedulePrompt.ts` for scheduling commands.
- `projectPrompt.ts` for project expansion.
- `summaryPrompt.ts` for daily/weekly summaries.

#### 4.3.3. LLM Client (Vercel AI SDK)

`ai/clients/llmClient.ts`:

- Wraps Vercel AI SDK.
- Provides a function like `callStructuredLLM` that:
  - Accepts a system prompt, user text, schema, and a logical model name.
  - Calls `client.chat.completions.parse(...)` with the schema.
  - Returns a validated object.

Also maps logical names to concrete models:

- `"cheap"` → `gpt-4.1-mini` or Gemini Flash
- `"smart"` → `gpt-4.1` or similar

`ai/clients/modelConfig.ts` can define:

```ts
pipelines: {
  taskParsing: { model: "cheap" },
  projectPlanning: { model: "smart" },
  dailySummary: { model: "smart" },
}
```

#### 4.3.4. Pipelines

Entry points for AI-powered transformations.

Example: `ai/pipelines/taskPipeline.ts`:

- `runTaskParsingPipeline(text: string): Promise<ParsedTask>`
  - Uses `taskParsingSystemPrompt`
  - Uses `ParsedTaskSchema`
  - Uses `callStructuredLLM` with the `"cheap"` model

Future pipelines:

- `runScheduleParsingPipeline(text: string)`
- `runProjectPlanningPipeline(text: string)`
- `runSummaryPipeline(tasks: Task[])`

The application layer only calls these pipelines and deals with typed data.

---

### 4.4. Infrastructure Layer (Notion / DB / Config / Logging)

**Responsibility:** Integrate external services and expose clean abstractions.

#### 4.4.1. Notion

- `notionClient.ts`:
  - Wraps official Notion SDK.
  - Handles auth & base config.

- `notionTaskRepo.ts`:
  - `createFromParsedTask(parsed: ParsedTask, source: string): Promise<Task>`
  - `listTodayTasks(): Promise<Task[]>`
  - `updateStatus(taskId: string, status: "Todo" | "Doing" | "Done"): Promise<Task>`

- `notionProjectRepo.ts` (later):
  - CRUD for Projects DB.
  - `createFromParsedProject(parsed: ParsedProject): Promise<Project>`

#### 4.4.2. DB / Logs (Optional at first)

- `pgClient.ts`:
  - Postgres connection for logs/metrics.

- `commandLogRepo.ts`:
  - Stores:
    - Raw text
    - Parsed JSON
    - Pipeline name
    - Success/failure
    - Timestamp

Helpful for debugging and improving prompts over time.

#### 4.4.3. Config

- `config/env.ts`:
  - Reads env variables:
    - Notion API key
    - LLM provider keys
    - Backend API key
    - Model ID overrides
  - Exposes a typed `env` object for rest of the app.

#### 4.4.4. Logging

- `logging/logger.ts`:
  - Minimal logger abstraction (console or a logging lib).

---

## 5. Initial Feature Slice: `/task` Capture

For your first proof of concept, you only need one vertical slice:

1. **Route**: `POST /task` (Fastify)
2. **Use-case**: `createTaskFromText`
3. **AI Pipeline**: `runTaskParsingPipeline`
4. **Repo**: `notionTaskRepo.createFromParsedTask`

Flow:

1. Client sends `{ text: "take out the trash at 8pm" }` to `/task`.
2. Route validates and calls `createTaskFromText`.
3. Use-case calls `runTaskParsingPipeline(text)` → `ParsedTask`.
4. Use-case calls `notionTaskRepo.createFromParsedTask(parsedTask, "http")` → `Task`.
5. Route returns `Task` JSON.
6. Task appears in Notion Tasks DB and thus in your widget/view.

Later you add `/schedule` and `/project` by repeating the same pattern with new schemas/prompts/pipelines and new use-cases.

---

## 6. Future Expansion

Once `/task` is solid, you can:

- Add `/schedule`:
  - New schema: `ParsedScheduleCommand`.
  - New pipeline: `runScheduleParsingPipeline`.
  - Use-case: `scheduleTaskFromText`:
    - Parse schedule details.
    - Update task or create time-blocks (Notion + Google Calendar).
- Add `/project`:
  - New schemas: `ParsedProject`, `ParsedProjectTask`.
  - New pipeline: `runProjectPlanningPipeline`.
  - Use-case: `populateProjectFromText`.
  - Repo: `notionProjectRepo`.

The architecture doesn’t change; you just add more AI pipelines + use-cases and reuse the same layers.

---

This gives you a clear, maintainable structure where:

- All AI details (prompts, schemas, models, pipelines) are centralized in `ai/`.
- Notion and other infra are centralized in `infra/`.
- Business flows live in `app/useCases/`.
- HTTP concerns stay in `interfaces/http/`.
