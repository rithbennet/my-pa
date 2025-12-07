export function buildTaskParsingPrompt(todayIsoDate: string, text: string) {
  return [
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
  ].join("\n");
}

