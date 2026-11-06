import type { ObjectId } from "mongodb";
import type { ChangeAction, ChangeDoc, Database, NoteDoc, ShownItem, TaskDoc, TaskDue } from "../db.ts";
import type { ChatMessage, Llm, LlmAnswer, MadeToolCall, Tool } from "../llm/openrouter.ts";
import { wallClockToInstant } from "../time.ts";
import { due as readDue, type Due } from "./classify.ts";
import { changeTaskDue, sameDue, setTaskStatus, shownDue } from "./tasks.ts";
import { optionalString, toolArguments } from "./tool-arguments.ts";

/** The most recent Notes, and Tasks, the model chooses among, so the request stays small. */
const CHOOSABLE_ITEMS = 200;
/** How much of each item's text the model sees. */
const PREVIEW_LENGTH = 160;

/** The model's reading of which item the User means and what to do to it. */
export type Proposal = {
  itemId: string;
  action: ChangeAction;
  heading?: string;
  /** A Note's new text. */
  text?: string;
  /** A Task's new Description. */
  description?: string;
  /** A Task's new due date on its owner's clock; null removes it, absent leaves it. */
  due?: Due;
};

const ACTIONS: ChangeAction[] = ["edit", "done", "reopen", "delete"];

const PROPOSE_CHANGE: Tool = {
  type: "function",
  function: {
    name: "propose_change",
    description: "Propose the change to the one Note or Task the person means. They confirm it before it is made.",
    parameters: {
      type: "object",
      properties: {
        item_id: { type: "string", description: "The ID of the Note or Task, exactly as listed." },
        action: {
          type: "string",
          enum: ACTIONS,
          description: "edit to change its details, done or reopen for a Task, delete to remove it.",
        },
        heading: { type: "string", description: "For edit: a new short heading, only if it should change." },
        text: { type: "string", description: "For editing a Note: its new full text, only if it should change." },
        description: { type: "string", description: "For editing a Task: its new full Description, only if it should change." },
        due_date: { type: "string", description: "For editing a Task: the new due date as YYYY-MM-DD, only if it should change." },
        due_time: { type: "string", description: "For editing a Task: the new due time as 24-hour HH:MM, only with a due_date." },
        remove_due: { type: "boolean", description: "For editing a Task: true to remove its due date." },
      },
      required: ["item_id", "action"],
      additionalProperties: false,
    },
  },
};

const ITEM_NOT_FOUND: Tool = {
  type: "function",
  function: {
    name: "item_not_found",
    description: "Use when none of the listed Notes or Tasks is the one the person means.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
};

/**
 * Asks the model which of the owner's Notes and Tasks the message is about and what to change; null when none
 * matches. Throws AllModelsFailedError when no model gives a usable answer.
 */
export async function resolveChange(
  llm: Llm,
  transcript: string,
  items: { notes: NoteDoc[]; tasks: TaskDoc[] },
  context: { today: { date: string; weekday: string }; timezone: string },
): Promise<LlmAnswer<Proposal | null>> {
  const lines = [
    ...items.tasks.map((task) => {
      const due = shownDue(task.due, context.timezone);
      const when = due ? ` | due ${due.date}${due.time ? ` ${due.time}` : ""}` : "";
      return `task ${task._id!.toHexString()}: "${task.heading}" | ${preview(task.description)}${when} | ${task.status}`;
    }),
    ...items.notes.map((note) => `note ${note._id!.toHexString()}: "${note.heading}" | ${preview(note.text)}`),
  ];
  const ids = new Set([...items.tasks, ...items.notes].map((item) => item._id!.toHexString()));
  const messages: ChatMessage[] = [
    {
      role: "system",
      content:
        "The person wants to change one of their Notes or Tasks. Call propose_change for the one they mean, " +
        "or item_not_found when none of these is it. Their Notes and Tasks, one per line with its ID:\n" +
        (lines.join("\n") || "(none)") +
        `\nToday is ${context.today.weekday} ${context.today.date}, in the person's timezone ${context.timezone}. ` +
        'Resolve relative dates such as "Monday" from today.',
    },
    { role: "user", content: transcript },
  ];
  return llm.callTool({ messages, tools: [PROPOSE_CHANGE, ITEM_NOT_FOUND], read: (call) => readProposal(call, ids) });
}

/** Throws on an unusable answer, so the next model is tried. */
function readProposal(call: MadeToolCall, ids: Set<string>): Proposal | null {
  if (call.name === ITEM_NOT_FOUND.function.name) return null;
  if (call.name !== PROPOSE_CHANGE.function.name) throw new Error(`Model called unoffered tool "${call.name}"`);
  const args = toolArguments(call.arguments);
  const itemId = optionalString(args, "item_id");
  // An ID that wasn't listed is someone else's item or a made-up one, so it is never changed.
  if (itemId === undefined || !ids.has(itemId)) return null;
  const action = optionalString(args, "action") as ChangeAction | undefined;
  if (action === undefined || !ACTIONS.includes(action)) throw new Error(`Model gave an unknown action "${action}"`);
  if (action !== "edit") return { itemId, action };

  const proposal: Proposal = { itemId, action };
  for (const key of ["heading", "text", "description"] as const) {
    const value = optionalString(args, key);
    if (value !== undefined) proposal[key] = value;
  }
  if (args.remove_due === true) proposal.due = null;
  else {
    const due = readDue(optionalString(args, "due_date"), optionalString(args, "due_time"));
    if (due !== null) proposal.due = due;
  }
  return proposal;
}

function preview(text: string): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine.length > PREVIEW_LENGTH ? `${oneLine.slice(0, PREVIEW_LENGTH)}…` : oneLine;
}

/** The owner's most recent Notes and Tasks, for the model to choose among. */
export async function choosableItems(database: Database, ownerId: ObjectId): Promise<{ notes: NoteDoc[]; tasks: TaskDoc[] }> {
  const recent = { sort: { createdAt: -1 as const }, limit: CHOOSABLE_ITEMS };
  const [notes, tasks] = await Promise.all([
    database.notes.find({ ownerId }, recent).toArray(),
    database.tasks.find({ ownerId }, recent).toArray(),
  ]);
  return { notes, tasks };
}

export function shownNote(note: Pick<NoteDoc, "heading" | "text">): ShownItem {
  return { kind: "note", heading: note.heading, text: note.text };
}

export function shownTask(task: Pick<TaskDoc, "heading" | "description" | "due" | "status">, timezone: string): ShownItem {
  return { kind: "task", heading: task.heading, description: task.description, due: shownDue(task.due, timezone), status: task.status };
}

/** The change a proposal makes to its item: the values to set, and the item as it would be after. */
export function planChange(
  proposal: Proposal,
  item: { kind: "note"; note: NoteDoc } | { kind: "task"; task: TaskDoc },
  timezone: string,
): Pick<ChangeDoc, "set" | "before" | "after"> {
  if (item.kind === "note") {
    const before = shownNote(item.note);
    if (proposal.action === "delete") return { set: {}, before, after: null };
    const set = {
      ...(proposal.heading !== undefined ? { heading: proposal.heading } : {}),
      ...(proposal.text !== undefined ? { text: proposal.text } : {}),
    };
    return { set, before, after: shownNote({ ...item.note, ...set }) };
  }

  const { task } = item;
  const before = shownTask(task, timezone);
  if (proposal.action === "delete") return { set: {}, before, after: null };
  if (proposal.action !== "edit") {
    return { set: {}, before, after: shownTask({ ...task, status: proposal.action === "done" ? "done" : "open" }, timezone) };
  }
  const set = {
    ...(proposal.heading !== undefined ? { heading: proposal.heading } : {}),
    ...(proposal.description !== undefined ? { description: proposal.description } : {}),
    ...(proposal.due !== undefined ? { due: storedDue(proposal.due, timezone) } : {}),
  };
  return { set, before, after: shownTask({ ...task, ...set }, timezone) };
}

function storedDue(due: Due, timezone: string): TaskDue {
  if (due === null) return null;
  if (due.time === undefined) return { kind: "date", date: due.date };
  return { kind: "moment", at: wallClockToInstant(due.date, due.time, timezone) };
}

/**
 * Makes a confirmed change. A due date change goes through changeTaskDue, so the Task's Reminder re-arms.
 * Returns the item's heading, or null when the item is gone.
 */
export async function applyChange(database: Database, change: ChangeDoc, now: () => Date): Promise<string | null> {
  const { ownerId, itemId, action, set } = change;
  if (change.itemKind === "note") {
    const note = await database.notes.findOne({ _id: itemId, ownerId });
    if (!note) return null;
    if (action === "delete") await database.notes.deleteOne({ _id: itemId });
    else await database.notes.updateOne({ _id: itemId }, { $set: { ...pick(set, ["heading", "text"]), updatedAt: now() } });
    return set.heading ?? note.heading;
  }

  const task = await database.tasks.findOne({ _id: itemId, ownerId });
  if (!task) return null;
  if (action === "delete") await database.tasks.deleteOne({ _id: itemId });
  else if (action === "done" || action === "reopen") {
    await setTaskStatus(database, ownerId, itemId, action === "done" ? "done" : "open", now);
  } else {
    await database.tasks.updateOne({ _id: itemId }, { $set: { ...pick(set, ["heading", "description"]), updatedAt: now() } });
    if (set.due !== undefined && !sameDue(set.due, task.due)) await changeTaskDue(database, itemId, set.due, now);
  }
  return set.heading ?? task.heading;
}

function pick<T extends object, K extends keyof T>(value: T, keys: K[]): Partial<Pick<T, K>> {
  return Object.fromEntries(keys.filter((key) => value[key] !== undefined).map((key) => [key, value[key]])) as Partial<Pick<T, K>>;
}
