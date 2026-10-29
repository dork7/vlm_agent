import type { ObjectId } from "mongodb";
import type { ChannelIdentity, Database } from "../db.ts";

/** The stages of a Run (ADR 0003), in the order they can happen. "query-answer" is a model call after a Query's lookups. */
export type RunStageName =
  | "received"
  | "download"
  | "conversion"
  | "transcription"
  | "classification"
  | "tool-call"
  | "query-answer"
  | "reply";

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
export type RunType = "note" | "task" | "query" | "task-list" | "command";

/** One pass of one inbound message through the bot, from arrival to the final reply. */
export type RunDoc = {
  _id?: ObjectId;
  sender: ChannelIdentity;
  chatId: string;
  messageId: string;
  content: "text" | "voice" | "clarification-answer";
  /** The User who sent it; null when the sender was refused. */
  userId: ObjectId | null;
  username: string | null;
  status: RunStatus;
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

export type StageOptions<T> = {
  details?: (value: T) => Record<string, unknown>;
  /** Details known even when the step throws, e.g. the model attempts carried by the error. */
  detailsOnError?: (error: unknown) => Record<string, unknown>;
  /** Why a step that returned normally still failed, or null when it didn't. */
  failure?: (value: T) => string | null;
};

export type RunRecorder = {
  readonly id: ObjectId;
  /** Runs one step as a timed stage; a throwing step is recorded as failed and rethrown. */
  stage<T>(name: RunStageName, step: () => Promise<T>, options?: StageOptions<T>): Promise<T>;
  /** Whether any stage has been recorded under this name. */
  has(name: RunStageName): boolean;
  set(fields: Partial<Pick<RunDoc, "userId" | "username" | "status" | "type" | "clarificationId">>): void;
  /** Marks the Run failed, blaming the last failed stage, or else the last stage. */
  fail(message?: string): void;
  /** Saves the finished Run. */
  finish(): Promise<void>;
};

/** Saves an in-progress Run for the message straight away, so a Run cut short by a restart still shows. */
export async function startRun(
  database: Database,
  message: Pick<RunDoc, "sender" | "chatId" | "messageId" | "content">,
  now: () => Date,
): Promise<RunRecorder> {
  const startedAt = now();
  const started = performance.now();
  const run: RunDoc = {
    ...message,
    userId: null,
    username: null,
    status: "in-progress",
    type: null,
    clarificationId: null,
    stages: [],
    error: null,
    startedAt,
    finishedAt: null,
    durationMs: null,
  };
  const { insertedId } = await database.runs.insertOne(run);

  return {
    id: insertedId,
    async stage(name, step, options = {}) {
      const stageStartedAt = now();
      const stageStarted = performance.now();
      const durationMs = () => Math.round(performance.now() - stageStarted);
      let value;
      try {
        value = await step();
      } catch (error) {
        run.stages.push({
          name,
          startedAt: stageStartedAt,
          durationMs: durationMs(),
          outcome: "failed",
          error: error instanceof Error ? error.message : String(error),
          details: options.detailsOnError?.(error) ?? {},
        });
        throw error;
      }
      const failure = options.failure?.(value) ?? null;
      run.stages.push({
        name,
        startedAt: stageStartedAt,
        durationMs: durationMs(),
        outcome: failure === null ? "succeeded" : "failed",
        ...(failure === null ? {} : { error: failure }),
        details: options.details?.(value) ?? {},
      });
      return value;
    },
    has: (name) => run.stages.some((stage) => stage.name === name),
    set(fields) {
      Object.assign(run, fields);
    },
    fail(message) {
      const failed = run.stages.findLast((stage) => stage.outcome === "failed") ?? run.stages.at(-1);
      run.status = "failed";
      run.error = { stage: failed?.name ?? null, message: message ?? failed?.error ?? "Unknown error" };
    },
    async finish() {
      if (run.status === "in-progress") run.status = "succeeded";
      run.finishedAt = now();
      run.durationMs = Math.round(performance.now() - started);
      const { _id, ...fields } = run as RunDoc & { _id?: ObjectId };
      await database.runs.updateOne({ _id: insertedId }, { $set: fields });
    },
  };
}
