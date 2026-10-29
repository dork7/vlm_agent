import { ObjectId } from "mongodb";
import {
  isDuplicateKeyError,
  type ChannelIdentity,
  type ClarificationDoc,
  type ClarificationOption,
  type Database,
  type TaskDoc,
  type TaskDue,
  type UserDoc,
} from "../db.ts";
import type { InventoryClient, InventoryRequest } from "../inventory/client.ts";
import { AllModelsFailedError, type Llm, type ModelAttempt } from "../llm/openrouter.ts";
import type { AudioSource, Transcriber } from "../transcriber/transcriber.ts";
import { findUserByChannelIdentity } from "../users.ts";
import { todayIn, wallClockToInstant } from "../time.ts";
import { classify, type Due } from "./classify.ts";
import { writeMarkdownCopies } from "./markdown.ts";
import { answerQuery } from "./query.ts";
import { listTasks } from "./tasks.ts";

export type { ClarificationOption, Due };

/** A message from any Channel, in a channel-neutral shape (ADR 0005). */
export type InboundMessage = {
  sender: ChannelIdentity;
  chatId: string;
  messageId: string;
  content:
    | { kind: "text"; text: string }
    | ({ kind: "voice" } & AudioSource)
    /** The User's choice in an earlier Clarification, e.g. a tapped button. */
    | { kind: "clarification-answer"; clarificationId: string; answer: ClarificationOption };
  clarifyWith: ClarifyWith;
};

/**
 * How a Channel's Clarifications are answered. With "text", while one is pending for the sender in the chat,
 * a typed reply is taken as its answer ("1/2/3" or the option's name) and anything else asks again.
 * With "buttons", the answer comes as a clarification-answer and typed messages are always new messages.
 */
export type ClarifyWith = "buttons" | "text";

/** The options a Clarification offers, in the order a text answer numbers them. */
export const CLARIFICATION_OPTIONS: ClarificationOption[] = ["note", "task", "query"];

/** Voice Messages longer than this are refused before anything is downloaded. */
export const MAX_VOICE_SECONDS = 5 * 60;

export type Result =
  | { kind: "note-saved"; heading: string }
  /** `due` is the date and optional time on the User's own clock. */
  | { kind: "task-saved"; heading: string; due: Due }
  /** `date` is the day the list was limited to, or null for all the User's Tasks. */
  | { kind: "tasks-listed"; tasks: ListedTask[]; more: number; date: string | null }
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

export type CoreEvent =
  | { type: "processing-started" }
  | { type: "result"; result: Result }
  /** The message is unclear; the User is asked which option it is. */
  | { type: "clarification-needed"; clarificationId: string; options: ClarificationOption[] };

export type EmitEvent = (event: CoreEvent) => Promise<void>;

/** What happened while handling a message, for its Run record (ticket 12). */
export type HandledMessage = {
  /** The Channel had already delivered this message; it was ignored. */
  duplicate: boolean;
  /** Present for a Voice Message that reached the Transcriber, whether or not it worked. */
  transcription:
    | { model: string; durationMs: number; transcriptLength: number }
    | { model: string; durationMs: number; error: string }
    | null;
  modelAttempts: ModelAttempt[];
  inventoryRequests: InventoryRequest[];
  /** The Clarification this message asked (it is then awaiting an answer), asked again, or answered. */
  clarification: { id: string; outcome: "asked" | "re-asked" | "answered" } | null;
};

/** What every step of handling one message works with. */
type Handling = { emit: EmitEvent; handled: HandledMessage; llm: Llm; inventory: InventoryClient };

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

  /** Records the message as being handled; false when the Channel already delivered it, even if that was before a restart. */
  const claimMessage = async (message: InboundMessage): Promise<boolean> => {
    try {
      await database.processedMessages.insertOne({
        channel: message.sender.channel,
        chatId: message.chatId,
        messageId: message.messageId,
        receivedAt: now(),
      });
      return true;
    } catch (error) {
      if (isDuplicateKeyError(error)) return false;
      throw error;
    }
  };

  const handle = async (message: InboundMessage, run: Handling) => {
    const { emit, handled } = run;
    const user = await findUserByChannelIdentity(database, message.sender);
    if (!user) {
      await emit({ type: "result", result: { kind: "refused" } });
      return;
    }

    const { content } = message;
    if (content.kind === "clarification-answer") {
      await answerClarification(user, content.clarificationId, content.answer, message.messageId, run);
      return;
    }
    if (message.clarifyWith === "text") {
      const pending = await database.clarifications.findOne(
        {
          ownerId: user._id!,
          "source.channel": message.sender.channel,
          "source.chatId": message.chatId,
          status: "pending",
        },
        { sort: { createdAt: -1 } },
      );
      if (pending) {
        // A Voice Message is not an answer either, so it asks again without being fetched.
        const answer = content.kind === "text" ? readClarificationAnswer(content.text) : null;
        const clarificationId = pending._id.toHexString();
        if (answer === null) await askClarification(clarificationId, "re-asked", run);
        else await answerClarification(user, clarificationId, answer, message.messageId, run);
        return;
      }
    }

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

    const source = { channel: message.sender.channel, chatId: message.chatId, messageId: message.messageId };
    await fileTranscript({ user, sender: message.sender, source, transcript }, run);
  };

  const askClarification = async (clarificationId: string, outcome: "asked" | "re-asked", run: Handling) => {
    run.handled.clarification = { id: clarificationId, outcome };
    await run.emit({ type: "clarification-needed", clarificationId, options: CLARIFICATION_OPTIONS });
  };

  /**
   * Completes a pending Clarification's message as the chosen type. A Clarification is answered only once;
   * if filing it fails, it is pending again so the User can answer it again.
   */
  const answerClarification = async (
    user: UserDoc,
    clarificationId: string,
    answer: ClarificationOption,
    answeredBy: string,
    run: Handling,
  ) => {
    const clarification = ObjectId.isValid(clarificationId)
      ? await database.clarifications.findOneAndUpdate(
          { _id: new ObjectId(clarificationId), ownerId: user._id!, status: "pending" },
          { $set: { status: "answered", answer, answeredBy, answeredAt: now() } },
          { returnDocument: "after" },
        )
      : null;
    if (!clarification) {
      console.warn(`Ignored an answer to Clarification ${clarificationId}: not pending for ${user.username}`);
      return;
    }
    run.handled.clarification = { id: clarificationId, outcome: "answered" };
    await run.emit({ type: "processing-started" });
    let filed = false;
    try {
      filed = await fileTranscript({ ...clarification, user }, run, answer);
    } finally {
      if (!filed) {
        await database.clarifications.updateOne(
          { _id: clarification._id },
          { $set: { status: "pending", answer: null, answeredBy: null, answeredAt: null } },
        );
      }
    }
  };

  /** Classifies the Transcript (as `fixedAs`, when the User has said) and acts on it; false when it failed. */
  const fileTranscript = async (
    message: Pick<ClarificationDoc, "sender" | "source" | "transcript"> & { user: UserDoc },
    run: Handling,
    fixedAs?: ClarificationOption,
  ): Promise<boolean> => {
    const { emit, handled, llm, inventory } = run;
    const { user, sender, transcript, source } = message;
    const timezone = user.timezone ?? defaultTimezone;
    let classification;
    try {
      ({ value: classification } = await classify(llm, transcript, { today: todayIn(now(), timezone), timezone, fixedAs }));
    } catch (error) {
      console.error("Classification failed", error);
      await emit({ type: "result", result: { kind: "error" } });
      return false;
    }

    if (classification.kind === "query") {
      let answer;
      try {
        answer = await answerQuery({ llm, inventory, ...classification });
      } catch (error) {
        console.error("Answering the Query failed", error);
        await emit({ type: "result", result: { kind: "error" } });
        return false;
      }
      await emit({ type: "result", result: { kind: "query-answered", answer } });
      return true;
    }

    if (classification.kind === "command") {
      await emit({ type: "result", result: { kind: "command-declined" } });
      return true;
    }

    if (classification.kind === "unclear") {
      const { insertedId } = await database.clarifications.insertOne({
        ownerId: user._id!,
        sender,
        source,
        transcript,
        status: "pending",
        answer: null,
        answeredBy: null,
        createdAt: now(),
        answeredAt: null,
      });
      await askClarification(insertedId.toHexString(), "asked", run);
      return true;
    }

    if (classification.kind === "list-tasks") {
      const { date } = classification;
      const { tasks, more } = await listTasks(database, user._id!, timezone, date);
      await emit({ type: "result", result: { kind: "tasks-listed", tasks, more, date } });
      return true;
    }

    const savedAt = now();

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
      return true;
    }

    await database.tasks.insertOne({
      ownerId: user._id!,
      heading: classification.heading,
      description: classification.description,
      due: storedDue(classification.due, timezone),
      status: "open",
      reminderSentAt: null,
      channelIdentity: sender,
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
    return true;
  };

  return {
    async handleMessage(message, emit) {
      // The transcription, and every model attempt and Inventory request, made for this message, even on failure.
      const handled: HandledMessage = {
        duplicate: false,
        transcription: null,
        modelAttempts: [],
        inventoryRequests: [],
        clarification: null,
      };
      if (!(await claimMessage(message))) return { ...handled, duplicate: true };
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
      await handle(message, { emit, handled, llm: recordingLlm, inventory: recordingInventory });
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

/** A typed answer to a Clarification: an option's number or name, or null when it is neither. */
function readClarificationAnswer(text: string): ClarificationOption | null {
  const reply = text
    .trim()
    .toLowerCase()
    .replace(/[.!]+$/, "")
    .replace(/^(a|an|the)\s+/, "");
  const index = Number(reply);
  if (Number.isInteger(index) && index >= 1 && index <= CLARIFICATION_OPTIONS.length) return CLARIFICATION_OPTIONS[index - 1]!;
  return CLARIFICATION_OPTIONS.find((option) => option === reply) ?? null;
}
