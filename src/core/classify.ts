import type { ChatMessage, Llm, LlmAnswer, MadeToolCall, Tool } from "../llm/openrouter.ts";
import { GET_ITEM, type InventoryToolCall, isInventoryToolCall, readInventoryToolCall, SEARCH_ITEMS } from "./query.ts";
import { optionalString, requiredString, toolArguments } from "./tool-arguments.ts";

export type Due = { date: string; time?: string } | null;

export type Classification =
  | { kind: "note"; heading: string }
  | { kind: "task"; heading: string; description: string; due: Due }
  /** `date` ("YYYY-MM-DD") limits the list to Tasks due that day on the User's own clock. */
  | { kind: "list-tasks"; date: string | null }
  /** A Query: the model's first Inventory lookup, and the conversation it came from so it can continue. */
  | { kind: "query"; conversation: ChatMessage[]; first: InventoryToolCall }
  /** A Command: a request to change Inventory data, which is not supported yet. */
  | { kind: "command" };

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
      "Show the person their saved Tasks. Use only when they ask to see their Tasks or to-do list, " +
      "not when they ask to add something to it.",
    parameters: {
      type: "object",
      properties: {
        date: {
          type: "string",
          description:
            "Only if they ask about one particular day (such as \"tomorrow\" or \"on Friday\"): that day as YYYY-MM-DD. " +
            "Omit to show all their Tasks.",
        },
      },
      additionalProperties: false,
    },
  },
};

const CHANGE_INVENTORY: Tool = {
  type: "function",
  function: {
    name: "change_inventory",
    description:
      "Use when the person asks to change Inventory data, such as adding or removing items or changing quantities. " +
      "Changes are not supported yet, so the request will be declined.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
};

const SYSTEM_PROMPT =
  "You file a person's messages. Read the message and call exactly one tool that fits it: " +
  "save_note for something to remember, save_task for something to do, " +
  "list_tasks when they ask to see their Tasks, " +
  "search_items or get_item when they ask about the Inventory (you will answer once you have the results), " +
  "change_inventory when they ask to change Inventory data.";

/** Throws AllModelsFailedError, carrying every attempt, when no model gives a usable answer. */
export async function classify(
  llm: Llm,
  transcript: string,
  context: { today: { date: string; weekday: string }; timezone: string },
): Promise<LlmAnswer<Classification>> {
  const messages: ChatMessage[] = [
    {
      role: "system",
      content:
        `${SYSTEM_PROMPT} Today is ${context.today.weekday} ${context.today.date}, ` +
        `in the person's timezone ${context.timezone}. Resolve relative dates such as "Thursday" from today.`,
    },
    { role: "user", content: transcript },
  ];
  return llm.callTool({
    messages,
    tools: [SAVE_NOTE, SAVE_TASK, LIST_TASKS, SEARCH_ITEMS, GET_ITEM, CHANGE_INVENTORY],
    read: (call) => readClassification(call, messages),
  });
}

/** Throws on an unusable answer, so the next model is tried. */
function readClassification(call: MadeToolCall, conversation: ChatMessage[]): Classification {
  if (isInventoryToolCall(call)) return { kind: "query", conversation, first: readInventoryToolCall(call) };
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
      return { kind: "list-tasks", date: listedDate(optionalString(args, "date")) };
    case CHANGE_INVENTORY.function.name:
      return { kind: "command" };
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

function listedDate(date: string | undefined): string | null {
  if (date === undefined) return null;
  if (!isCalendarDate(date)) throw new Error(`Model gave an invalid list_tasks date "${date}"`);
  return date;
}

function isCalendarDate(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  return new Date(`${date}T00:00:00Z`).toISOString().startsWith(date);
}
