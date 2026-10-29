import type { Llm, Tool } from "../llm/openrouter.ts";

export type Due = { date: string; time?: string } | null;

export type Classification =
  | { kind: "note"; heading: string }
  | { kind: "task"; heading: string; description: string; due: Due }
  | { kind: "list-tasks" };

const HEADING = {
  type: "string",
  description: "A short line, under ten words, naming the most important point of the message.",
};

const SAVE_NOTE: Tool = {
  type: "function",
  function: {
    name: "save_note",
    description: "Save the message as a Note: something the person wants remembered for later reading.",
    parameters: {
      type: "object",
      properties: { heading: HEADING },
      required: ["heading"],
      additionalProperties: false,
    },
  },
};

const SAVE_TASK: Tool = {
  type: "function",
  function: {
    name: "save_task",
    description:
      "Save the message as a Task: something the person intends to do later. " +
      "Save one Task per message, even when it mentions several things to do.",
    parameters: {
      type: "object",
      properties: {
        heading: { ...HEADING, description: "A short line, under ten words, naming the most important thing to do." },
        description: {
          type: "string",
          description: "Everything the person said they need to do, covering every item and detail mentioned.",
        },
        due_date: {
          type: "string",
          description: "The due date as YYYY-MM-DD, only if the person mentioned when. Omit otherwise.",
        },
        due_time: {
          type: "string",
          description: "The due time as 24-hour HH:MM, only if the person mentioned a time. Omit otherwise.",
        },
      },
      required: ["heading", "description"],
      additionalProperties: false,
    },
  },
};

const LIST_TASKS: Tool = {
  type: "function",
  function: {
    name: "list_tasks",
    description:
      "Show the person all their saved Tasks. Use only when they ask to see their Tasks or to-do list, " +
      "not when they ask to add something to it.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
};

const SYSTEM_PROMPT =
  "You file a person's messages. Read the message and call exactly one tool that fits it: " +
  "save_note for something to remember, save_task for something to do, " +
  "list_tasks when they ask to see their Tasks.";

export async function classify(
  llm: Llm,
  transcript: string,
  context: { today: { date: string; weekday: string }; timezone: string },
): Promise<Classification> {
  const call = await llm.callTool({
    messages: [
      {
        role: "system",
        content:
          `${SYSTEM_PROMPT} Today is ${context.today.weekday} ${context.today.date}, ` +
          `in the person's timezone ${context.timezone}. Resolve relative dates such as "Thursday" from today.`,
      },
      { role: "user", content: transcript },
    ],
    tools: [SAVE_NOTE, SAVE_TASK, LIST_TASKS],
  });

  const args = toolArguments(call.arguments);
  switch (call.name) {
    case SAVE_NOTE.function.name:
      return { kind: "note", heading: requiredString(args, "heading") };
    case SAVE_TASK.function.name:
      return {
        kind: "task",
        heading: requiredString(args, "heading"),
        description: requiredString(args, "description"),
        due: due(optionalString(args, "due_date"), optionalString(args, "due_time")),
      };
    case LIST_TASKS.function.name:
      return { kind: "list-tasks" };
    default:
      throw new Error(`Model called unknown tool "${call.name}"`);
  }
}

function due(date: string | undefined, time: string | undefined): Due {
  if (date === undefined) {
    if (time !== undefined) throw new Error(`Model gave due_time "${time}" without a due_date`);
    return null;
  }
  if (!isCalendarDate(date)) throw new Error(`Model gave an invalid due_date "${date}"`);
  if (time === undefined) return { date };
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error(`Model gave an invalid due_time "${time}"`);
  return { date, time };
}

function isCalendarDate(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  return new Date(`${date}T00:00:00Z`).toISOString().startsWith(date);
}

function toolArguments(raw: string): Record<string, unknown> {
  const args: unknown = JSON.parse(raw);
  if (typeof args !== "object" || args === null || Array.isArray(args)) {
    throw new Error("Model's tool arguments are not an object");
  }
  return args as Record<string, unknown>;
}

function optionalString(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") throw new Error(`Model gave a non-string "${key}"`);
  return value.trim() || undefined;
}

function requiredString(args: Record<string, unknown>, key: string): string {
  const value = optionalString(args, key);
  if (value === undefined) throw new Error(`Model left out "${key}"`);
  return value;
}
