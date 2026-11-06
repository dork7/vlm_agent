import { MongoClient, MongoServerError, type Collection, type Db, type ObjectId } from "mongodb";
import { TRANSCRIPTION_STAGES } from "./transcriber/transcriber.ts";

export type ChannelIdentity = { channel: string; channelId: string };

export type PasswordHash = { algorithm: "scrypt"; salt: string; hash: string };

export type UserDoc = {
  _id?: ObjectId;
  username: string;
  password: PasswordHash;
  isAdmin: boolean;
  /** IANA timezone in which this User's due dates and times are meant; absent means the configured default. */
  timezone?: string;
  channelIdentities: ChannelIdentity[];
  createdAt: Date;
};

export type NoteDoc = {
  _id?: ObjectId;
  ownerId: ObjectId;
  heading: string;
  text: string;
  transcript: string;
  source: { channel: string; chatId: string; messageId: string };
  createdAt: Date;
  updatedAt: Date;
};

/** When a Task is due: a moment (date with a time), a whole day (date only), or never. */
export type TaskDue = { kind: "moment"; at: Date } | { kind: "date"; date: string } | null;

export type TaskDoc = {
  _id?: ObjectId;
  ownerId: ObjectId;
  heading: string;
  description: string;
  due: TaskDue;
  status: "open" | "done";
  reminderSentAt: Date | null;
  /** Failed tries to deliver the Reminder for the current due date; absent means none. Stops at a limit. */
  reminderAttempts?: number;
  channelIdentity: ChannelIdentity;
  transcript: string;
  source: { channel: string; chatId: string; messageId: string };
  createdAt: Date;
  updatedAt: Date;
};

/** A message the bot has started handling, so that a second delivery of it is ignored. */
export type ProcessedMessageDoc = {
  channel: string;
  chatId: string;
  messageId: string;
  receivedAt: Date;
};

/** What the User can say an unclear message is. */
export type ClarificationOption = "note" | "task" | "query";

/** A Clarification the bot asked; it stays pending, with no timeout, until the User answers. */
export type ClarificationDoc = {
  _id?: ObjectId;
  ownerId: ObjectId;
  sender: ChannelIdentity;
  /** The unclear message, which the answer completes. */
  source: { channel: string; chatId: string; messageId: string };
  transcript: string;
  status: "pending" | "answered";
  answer: ClarificationOption | null;
  /** The ID of the message that answered it, on the same Channel. */
  answeredBy: string | null;
  createdAt: Date;
  answeredAt: Date | null;
};

/** What a change from the chat does to one Note or Task. */
export type ChangeAction = "edit" | "done" | "reopen" | "delete";

/** A Note or Task as shown when confirming a change; a Task's `due` is on its owner's own clock. */
export type ShownItem =
  | { kind: "note"; heading: string; text: string }
  | { kind: "task"; heading: string; description: string; due: { date: string; time?: string } | null; status: TaskDoc["status"] };

/**
 * A change to one of the User's Notes or Tasks asked for in the chat. Nothing happens until the User
 * confirms it; it is then applied once, or cancelled.
 */
export type ChangeDoc = {
  _id?: ObjectId;
  ownerId: ObjectId;
  sender: ChannelIdentity;
  /** The message that asked for the change. */
  source: { channel: string; chatId: string; messageId: string };
  itemKind: "note" | "task";
  itemId: ObjectId;
  action: ChangeAction;
  /** The new values an edit sets; a Task's due date is stored as on the Task. */
  set: { heading?: string; text?: string; description?: string; due?: TaskDue };
  /** The item as shown when the change was proposed, and as it would be after (null for a delete). */
  before: ShownItem;
  after: ShownItem | null;
  status: "pending" | "confirmed" | "cancelled";
  createdAt: Date;
  answeredAt: Date | null;
};

/**
 * The stages of a Run (ADR 0003), in the order they can happen. "change-resolution" is a model call that picks the
 * item a change from the chat is about; "query-answer" is a model call after a Query's lookups.
 */
export const RUN_STAGES = [
  "received",
  ...TRANSCRIPTION_STAGES,
  "classification",
  "change-resolution",
  "tool-call",
  "query-answer",
  "reply",
] as const;

export type RunStageName = (typeof RUN_STAGES)[number];

export type RunStage = {
  name: RunStageName;
  startedAt: Date;
  durationMs: number;
  outcome: "succeeded" | "failed";
  /** Why the stage failed. */
  error?: string;
  /** What the stage did, e.g. every model attempt, or a tool call's endpoint and HTTP status. */
  details: Record<string, unknown>;
};

export type RunStatus = "in-progress" | "succeeded" | "failed" | "awaiting-clarification" | "refused";

/** What the message turned out to be. */
export type RunType = "note" | "task" | "query" | "task-list" | "note-list" | "change" | "command" | "greeting";

/** One pass of one inbound message through the bot, from arrival to the final reply. */
export type RunDoc = {
  _id?: ObjectId;
  sender: ChannelIdentity;
  chatId: string;
  messageId: string;
  /** What arrived; a reply that answers a Clarification, or confirms or cancels a change, is counted as that. */
  content: "text" | "voice" | "clarification-answer" | "change-answer";
  /** The User who sent it; null when the sender was refused. */
  userId: ObjectId | null;
  username: string | null;
  status: RunStatus;
  /**
   * What the message turned out to be. A Clarification answer, or a change's confirmation, has none: the Run
   * that asked for it takes the type, so the message is counted once.
   */
  type: RunType | null;
  /** The Clarification this Run asked, asked again, or answered. */
  clarificationId: ObjectId | null;
  stages: RunStage[];
  /** For a failed Run: what went wrong, and in which stage. */
  error: { stage: RunStageName | null; message: string } | null;
  startedAt: Date;
  finishedAt: Date | null;
  durationMs: number | null;
};

export type Database = {
  db: Db;
  users: Collection<UserDoc>;
  notes: Collection<NoteDoc>;
  tasks: Collection<TaskDoc>;
  processedMessages: Collection<ProcessedMessageDoc>;
  clarifications: Collection<ClarificationDoc>;
  changes: Collection<ChangeDoc>;
  /** One per inbound message (ADR 0003). */
  runs: Collection<RunDoc>;
  close(): Promise<void>;
};

export async function connectDatabase(uri: string, dbName: string): Promise<Database> {
  const client = await MongoClient.connect(uri);
  const db = client.db(dbName);
  const users = db.collection<UserDoc>("users");
  await users.createIndex({ username: 1 }, { unique: true });
  await users.createIndex(
    { "channelIdentities.channel": 1, "channelIdentities.channelId": 1 },
    { unique: true, partialFilterExpression: { "channelIdentities.channel": { $exists: true } } },
  );

  const processedMessages = db.collection<ProcessedMessageDoc>("processedMessages");
  await processedMessages.createIndex({ channel: 1, chatId: 1, messageId: 1 }, { unique: true });

  const clarifications = db.collection<ClarificationDoc>("clarifications");
  await clarifications.createIndex({ ownerId: 1, "source.channel": 1, "source.chatId": 1, status: 1 });

  const changes = db.collection<ChangeDoc>("changes");
  await changes.createIndex({ ownerId: 1, "source.channel": 1, "source.chatId": 1, status: 1 });

  const tasks = db.collection<TaskDoc>("tasks");
  // The Reminder check every minute looks for open Tasks not yet reminded.
  await tasks.createIndex({ status: 1, reminderSentAt: 1 });

  const runs = db.collection<RunDoc>("runs");
  // The observability dashboard lists recent Runs, and finds those of an answered Clarification.
  await runs.createIndex({ startedAt: -1 });
  await runs.createIndex({ clarificationId: 1, status: 1 });

  return {
    db,
    users,
    notes: db.collection<NoteDoc>("notes"),
    tasks,
    processedMessages,
    clarifications,
    changes,
    runs,
    close: () => client.close(),
  };
}

export function isDuplicateKeyError(error: unknown): boolean {
  return error instanceof MongoServerError && error.code === 11000;
}
