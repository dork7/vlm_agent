import type { ChannelIdentity, Database, TaskDoc, TaskDue, UserDoc } from "../db.ts";
import type { InventoryClient, InventoryRequest } from "../inventory/client.ts";
import { AllModelsFailedError, type Llm, type ModelAttempt } from "../llm/openrouter.ts";
import type { AudioSource, Transcriber } from "../transcriber/transcriber.ts";
import { findUserByChannelIdentity } from "../users.ts";
import { todayIn, wallClockToInstant } from "../time.ts";
import { classify, type Due } from "./classify.ts";
import { writeMarkdownCopies } from "./markdown.ts";
import { answerQuery } from "./query.ts";
import { listTasks } from "./tasks.ts";

export type { Due };

/** A message from any Channel, in a channel-neutral shape (ADR 0005). */
export type InboundMessage = {
  sender: ChannelIdentity;
  chatId: string;
  messageId: string;
  content: { kind: "text"; text: string } | ({ kind: "voice" } & AudioSource);
};

/** Voice Messages longer than this are refused before anything is downloaded. */
export const MAX_VOICE_SECONDS = 5 * 60;

export type Result =
  | { kind: "note-saved"; heading: string }
  /** `due` is the date and optional time on the User's own clock. */
  | { kind: "task-saved"; heading: string; due: Due }
  | { kind: "tasks-listed"; tasks: ListedTask[]; more: number }
  /** A plain-language answer to a Query about the Inventory. */
  | { kind: "query-answered"; answer: string }
  /** A Command: changing Inventory data is not supported yet. */
  | { kind: "command-declined" }
  /** A Voice Message over the 5-minute limit; the User is asked to split it. */
  | { kind: "voice-too-long"; maxSeconds: number }
  | { kind: "refused" }
  | { kind: "error" };

/** A Task as shown to its owner; `due` is on the owner's own clock. */
export type ListedTask = { heading: string; due: Due; status: TaskDoc["status"] };

export type CoreEvent = { type: "processing-started" } | { type: "result"; result: Result };

export type EmitEvent = (event: CoreEvent) => Promise<void>;

/** What happened while handling a message, for its Run record (ticket 12). */
export type HandledMessage = {
  /** Present for a Voice Message that reached the Transcriber, whether or not it worked. */
  transcription:
    | { model: string; durationMs: number; transcriptLength: number }
    | { model: string; durationMs: number; error: string }
    | null;
  modelAttempts: ModelAttempt[];
  inventoryRequests: InventoryRequest[];
};

export type Core = {
  handleMessage(message: InboundMessage, emit: EmitEvent): Promise<HandledMessage>;
};

export function createCore(deps: {
  database: Database;
  llm: Llm;
  inventory: InventoryClient;
  transcriber: Transcriber;
  defaultTimezone: string;
  /** Folder for each User's read-only Markdown copies of their Tasks and Notes; none are written when absent. */
  markdownDir?: string;
  now?: () => Date;
}): Core {
  const { database, defaultTimezone, markdownDir, now = () => new Date() } = deps;

  const refreshMarkdownCopies = async (user: UserDoc, timezone: string) => {
    if (markdownDir === undefined) return;
    try {
      await writeMarkdownCopies(database, user, markdownDir, timezone);
    } catch (error) {
      console.error(`Failed to write Markdown copies for ${user.username}`, error);
    }
  };

  const handle = async (
    message: InboundMessage,
    emit: EmitEvent,
    handled: HandledMessage,
    llm: Llm,
    inventory: InventoryClient,
  ) => {
    const user = await findUserByChannelIdentity(database, message.sender);
    if (!user) {
      await emit({ type: "result", result: { kind: "refused" } });
      return;
    }

    const { content } = message;
    if (content.kind === "voice" && content.durationSeconds > MAX_VOICE_SECONDS) {
      await emit({ type: "result", result: { kind: "voice-too-long", maxSeconds: MAX_VOICE_SECONDS } });
      return;
    }

    await emit({ type: "processing-started" });

    let transcript;
    if (content.kind === "text") {
      transcript = content.text;
    } else {
      const { model } = deps.transcriber;
      const startedAt = performance.now();
      const durationMs = () => Math.round(performance.now() - startedAt);
      try {
        transcript = await deps.transcriber.transcribe(content);
      } catch (error) {
        console.error("Transcription failed", error);
        handled.transcription = { model, durationMs: durationMs(), error: errorMessage(error) };
        await emit({ type: "result", result: { kind: "error" } });
        return;
      }
      handled.transcription = { model, durationMs: durationMs(), transcriptLength: transcript.length };
    }

    const timezone = user.timezone ?? defaultTimezone;
    let classification;
    try {
      ({ value: classification } = await classify(llm, transcript, { today: todayIn(now(), timezone), timezone }));
    } catch (error) {
      console.error("Classification failed", error);
      await emit({ type: "result", result: { kind: "error" } });
      return;
    }

    if (classification.kind === "query") {
      let answer;
      try {
        answer = await answerQuery({ llm, inventory, ...classification });
      } catch (error) {
        console.error("Answering the Query failed", error);
        await emit({ type: "result", result: { kind: "error" } });
        return;
      }
      await emit({ type: "result", result: { kind: "query-answered", answer } });
      return;
    }

    if (classification.kind === "command") {
      await emit({ type: "result", result: { kind: "command-declined" } });
      return;
    }

    if (classification.kind === "list-tasks") {
      const { tasks, more } = await listTasks(database, user._id!, timezone);
      await emit({ type: "result", result: { kind: "tasks-listed", tasks, more } });
      return;
    }

    const savedAt = now();
    const source = { channel: message.sender.channel, chatId: message.chatId, messageId: message.messageId };

    if (classification.kind === "note") {
      await database.notes.insertOne({
        ownerId: user._id!,
        heading: classification.heading,
        text: transcript,
        transcript,
        source,
        createdAt: savedAt,
        updatedAt: savedAt,
      });
      await refreshMarkdownCopies(user, timezone);
      await emit({ type: "result", result: { kind: "note-saved", heading: classification.heading } });
      return;
    }

    await database.tasks.insertOne({
      ownerId: user._id!,
      heading: classification.heading,
      description: classification.description,
      due: storedDue(classification.due, timezone),
      status: "open",
      reminderSentAt: null,
      channelIdentity: message.sender,
      transcript,
      source,
      createdAt: savedAt,
      updatedAt: savedAt,
    });
    await refreshMarkdownCopies(user, timezone);
    await emit({
      type: "result",
      result: { kind: "task-saved", heading: classification.heading, due: classification.due },
    });
  };

  return {
    async handleMessage(message, emit) {
      // The transcription, and every model attempt and Inventory request, made for this message, even on failure.
      const handled: HandledMessage = { transcription: null, modelAttempts: [], inventoryRequests: [] };
      const recordingLlm: Llm = {
        async callTool(request) {
          try {
            const answer = await deps.llm.callTool(request);
            handled.modelAttempts.push(...answer.attempts);
            return answer;
          } catch (error) {
            if (error instanceof AllModelsFailedError) handled.modelAttempts.push(...error.attempts);
            throw error;
          }
        },
      };
      const recordingInventory: InventoryClient = {
        async lookup(lookup) {
          const result = await deps.inventory.lookup(lookup);
          handled.inventoryRequests.push(result.request);
          return result;
        },
      };
      await handle(message, emit, handled, recordingLlm, recordingInventory);
      return handled;
    },
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function storedDue(due: Due, timezone: string): TaskDue {
  if (due === null) return null;
  if (due.time === undefined) return { kind: "date", date: due.date };
  return { kind: "moment", at: wallClockToInstant(due.date, due.time, timezone) };
}
