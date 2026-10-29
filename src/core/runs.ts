import type { ObjectId } from "mongodb";
import type { Database, RunDoc, RunStageName, RunType } from "../db.ts";
import type { InventoryClient } from "../inventory/client.ts";
import { AllModelsFailedError, type Llm } from "../llm/openrouter.ts";
import type { TimeStage } from "../transcriber/transcriber.ts";
import type { CoreEvent, EmitEvent, HandledMessage, Result } from "./core.ts";

export type StageOptions<T> = {
  details?: (value: T) => Record<string, unknown>;
  /** Details known even when the step throws, e.g. the model attempts carried by the error. */
  detailsOnError?: (error: unknown) => Record<string, unknown>;
  /** Why a step that returned normally still failed, or null when it didn't. */
  failure?: (value: T) => string | null;
};

/** An event that completes a message, and so settles its Run. */
export type SettlingEvent = Exclude<CoreEvent, { type: "processing-started" }>;

export type RunRecorder = {
  readonly id: ObjectId;
  /** Runs one step as a timed stage; a throwing step is recorded as failed and rethrown. */
  stage<T>(name: RunStageName, step: () => Promise<T>, options?: StageOptions<T>): Promise<T>;
  set(fields: Partial<Pick<RunDoc, "userId" | "username" | "status" | "clarificationId">>): void;
  /** Records that the message answers a Clarification, so the Run takes no type of its own. */
  answersClarification(): void;
  /** Sets the Run's status, and its type, from what the message came to. */
  settle(event: SettlingEvent): void;
  /** Marks the Run failed, blaming the last failed stage, or else the last stage. */
  fail(message?: string): void;
  /** Saves the finished Run. */
  finish(): Promise<void>;
};

/** The Run's type for each result that completes a message. */
const RESULT_TYPES: Partial<Record<Result["kind"], RunType>> = {
  "note-saved": "note",
  "task-saved": "task",
  "query-answered": "query",
  "tasks-listed": "task-list",
  "command-declined": "command",
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

  const fail = (message?: string) => {
    const failed = run.stages.findLast((stage) => stage.outcome === "failed") ?? run.stages.at(-1);
    run.status = "failed";
    run.error = { stage: failed?.name ?? null, message: message ?? failed?.error ?? "Unknown error" };
  };

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
          error: errorMessage(error),
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
    set(fields) {
      Object.assign(run, fields);
    },
    answersClarification() {
      run.content = "clarification-answer";
    },
    settle(event) {
      if (event.type === "clarification-needed") {
        run.status = "awaiting-clarification";
        return;
      }
      const { result } = event;
      // A Voice Message over the limit is refused, like an unknown sender, rather than failed.
      if (result.kind === "refused" || result.kind === "voice-too-long") {
        run.status = "refused";
        return;
      }
      if (result.kind === "error") return fail();
      run.status = "succeeded";
      run.type = run.content === "clarification-answer" ? null : (RESULT_TYPES[result.kind] ?? null);
    },
    fail,
    async finish() {
      if (run.status === "in-progress") run.status = "succeeded";
      run.finishedAt = now();
      run.durationMs = Math.round(performance.now() - started);
      const { _id, ...fields } = run;
      await database.runs.updateOne({ _id: insertedId }, { $set: fields });
    },
  };
}

/** The Llm, with each call recorded as a stage: the first classifies the message, later ones write a Query's answer. */
export function recordingLlm(recorder: RunRecorder, llm: Llm, handled: Pick<HandledMessage, "modelAttempts">): Llm {
  let modelCalls = 0;
  return {
    callTool(request) {
      return recorder.stage(
        modelCalls++ === 0 ? "classification" : "query-answer",
        async () => {
          try {
            const answer = await llm.callTool(request);
            handled.modelAttempts.push(...answer.attempts);
            return answer;
          } catch (error) {
            if (error instanceof AllModelsFailedError) handled.modelAttempts.push(...error.attempts);
            throw error;
          }
        },
        {
          details: (answer) => ({ attempts: answer.attempts }),
          detailsOnError: (error) => (error instanceof AllModelsFailedError ? { attempts: error.attempts } : {}),
        },
      );
    },
  };
}

/** The Inventory client, with each lookup recorded as a "tool-call" stage. */
export function recordingInventory(
  recorder: RunRecorder,
  inventory: InventoryClient,
  handled: Pick<HandledMessage, "inventoryRequests">,
): InventoryClient {
  return {
    lookup(lookup) {
      return recorder.stage(
        "tool-call",
        async () => {
          const result = await inventory.lookup(lookup);
          handled.inventoryRequests.push(result.request);
          return result;
        },
        {
          details: ({ request }) => ({ ...request }),
          // Not finding an item by its SKU is an answer, not a failure.
          failure: ({ request }) =>
            request.status === 200 || request.status === 404 ? null : (request.error ?? `HTTP ${request.status}`),
        },
      );
    },
  };
}

/** Whatever the message comes to settles the Run, and sending it is the "reply" stage. */
export function recordingEmit(recorder: RunRecorder, emit: EmitEvent): EmitEvent {
  return async (event) => {
    if (event.type === "processing-started") return emit(event);
    recorder.settle(event);
    await recorder.stage("reply", () => emit(event), {
      details: () => ({ sent: event.type === "result" ? event.result.kind : event.type }),
    });
  };
}

/** Times each step of transcribing as its own stage, noting the model and how long the Transcript was. */
export function recordingTimeStage(recorder: RunRecorder, model: string): TimeStage {
  return (name, step) =>
    recorder.stage(name, step, {
      details: (value) => (name === "transcription" ? { model, transcriptLength: String(value).length } : {}),
      detailsOnError: () => (name === "transcription" ? { model } : {}),
    });
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
