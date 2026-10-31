import type { ClarificationOption } from "../db.ts";
import type { ChatMessage, Llm, LlmAnswer, MadeToolCall, Tool } from "../llm/openrouter.ts";
import { GET_ITEM, type InventoryToolCall, isInventoryToolCall, readInventoryToolCall, SEARCH_ITEMS } from "./query.ts";
import { optionalString, requiredString, toolArguments } from "./tool-arguments.ts";

export type Due = { date: string; time?: string } | null;

export type Classification =
  | { kind: "note"; heading: string }
  | { kind: "task"; heading: string; description: string; due: Due }
  /** `date` ("YYYY-MM-DD") limits the list to Tasks due that day on the User's own clock. */
  | { kind: "list-tasks"; date: string | null }
  | { kind: "list-notes" }
  /** A request to edit, complete, reopen or delete one of the User's Notes or Tasks; which one is resolved next. */
  | { kind: "change" }
  /** A Query: the model's first Inventory lookup, and the conversation it came from so it can continue. */
  | { kind: "query"; conversation: ChatMessage[]; first: InventoryToolCall }
  /** A Command: a request to change Inventory data, which is not supported yet. */
  | { kind: "command" }
  /** A greeting such as "hi", answered by saying what the bot can do. */
  | { kind: "greeting" }
  /** The model can't tell whether the message is a Note, Task or Query, so a Clarification is asked. */
  | { kind: "unclear" };

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
      "Save one Task per message, even when it mentions several things to do. " +
      "Not for moving or changing a Task they already have.",
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

const LIST_NOTES: Tool = {
  type: "function",
  function: {
    name: "list_notes",
    description:
      'Show the person all their saved Notes. Use only when they ask to see their Notes, such as "show notes" ' +
      'or "what are my notes?", not when they want something saved as a Note.',
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
};

const CHANGE_ITEM: Tool = {
  type: "function",
  function: {
    name: "change_item",
    description:
      "Use when the person wants to change one of their existing Notes or Tasks: edit it (such as moving a Task " +
      'to another day or time, or updating what a Note says), mark a Task done ("I called the supplier") or open ' +
      "again, or delete one. Not for saving something new.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
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

const GREET: Tool = {
  type: "function",
  function: {
    name: "greet",
    description:
      'Use when the message is only a greeting or small talk, such as "hi", "hello" or "good morning", ' +
      "with nothing to save or look up.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
};

const ASK_CLARIFICATION: Tool = {
  type: "function",
  function: {
    name: "ask_clarification",
    description:
      "Use only when you can't tell whether the message is a Note, a Task or a Query about the Inventory. " +
      "The person will be asked which it is.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
};

/** The tools for each type a Clarification answer can fix the message as. */
const TOOLS_FOR: Record<ClarificationOption, Tool[]> = {
  note: [SAVE_NOTE],
  task: [SAVE_TASK],
  query: [SEARCH_ITEMS, GET_ITEM],
};

const NAMED: Record<ClarificationOption, string> = { note: "a Note", task: "a Task", query: "a Query about the Inventory" };

const SYSTEM_PROMPT =
  "You file a person's messages. Read the message and call exactly one tool that fits it: " +
  "save_note for something to remember, save_task for something to do, " +
  "list_tasks when they ask to see their Tasks, " +
  "list_notes when they ask to see their Notes, " +
  "change_item when they want to edit, complete, reopen or delete one of their Notes or Tasks, " +
  "search_items or get_item when they ask about the Inventory (you will answer once you have the results), " +
  "change_inventory when they ask to change Inventory data, " +
  "greet when it is only a greeting, " +
  "ask_clarification only when you can't tell whether it is a Note, a Task or a Query.";

/**
 * With `fixedAs`, the User has already said in a Clarification what the message is, so only that type's tools are offered.
 * Throws AllModelsFailedError, carrying every attempt, when no model gives a usable answer.
 */
export async function classify(
  llm: Llm,
  transcript: string,
  context: {
    today: { date: string; weekday: string };
    timezone: string;
    fixedAs?: ClarificationOption;
    /** The headings of the person's own Notes and Tasks, so a message about one of them reads as a change. */
    existing?: { notes: string[]; tasks: string[] };
  },
): Promise<LlmAnswer<Classification>> {
  const { fixedAs } = context;
  const instructions =
    fixedAs === undefined
      ? SYSTEM_PROMPT
      : `You file a person's messages. They have said this message is ${NAMED[fixedAs]}; call the tool that files it as that.`;
  const messages: ChatMessage[] = [
    {
      role: "system",
      content:
        `${instructions} Today is ${context.today.weekday} ${context.today.date}, ` +
        `in the person's timezone ${context.timezone}. Resolve relative dates such as "Thursday" from today.` +
        existingItems(context.existing),
    },
    { role: "user", content: transcript },
  ];
  const tools =
    fixedAs === undefined
      ? [SAVE_NOTE, SAVE_TASK, LIST_TASKS, LIST_NOTES, CHANGE_ITEM, SEARCH_ITEMS, GET_ITEM, CHANGE_INVENTORY, GREET, ASK_CLARIFICATION]
      : TOOLS_FOR[fixedAs];
  return llm.callTool({
    messages,
    tools,
    read: (call) => readClassification(call, messages, tools),
  });
}

function existingItems(existing: { notes: string[]; tasks: string[] } | undefined): string {
  if (!existing || existing.notes.length + existing.tasks.length === 0) return "";
  const list = (headings: string[]) => (headings.length ? headings.map((heading) => `"${heading}"`).join(", ") : "none");
  return (
    `\nThe person already has these Tasks: ${list(existing.tasks)}; and these Notes: ${list(existing.notes)}. ` +
    "When the message is about changing, completing or deleting one of them, call change_item rather than saving it again."
  );
}

/** Throws on an unusable answer, so the next model is tried. */
function readClassification(call: MadeToolCall, conversation: ChatMessage[], offered: Tool[]): Classification {
  if (!offered.some((tool) => tool.function.name === call.name)) throw new Error(`Model called unoffered tool "${call.name}"`);
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
    case LIST_NOTES.function.name:
      return { kind: "list-notes" };
    case CHANGE_ITEM.function.name:
      return { kind: "change" };
    case CHANGE_INVENTORY.function.name:
      return { kind: "command" };
    case GREET.function.name:
      return { kind: "greeting" };
    case ASK_CLARIFICATION.function.name:
      return { kind: "unclear" };
    default:
      throw new Error(`Model called unknown tool "${call.name}"`);
  }
}

export function due(date: string | undefined, time: string | undefined): Due {
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
