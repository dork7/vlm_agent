import type { ObjectId } from "mongodb";
import type { Database, TaskDue, UserDoc } from "../db.ts";
import type { InventoryClient } from "../inventory/client.ts";
import type { Llm } from "../llm/openrouter.ts";
import type { AudioSource, Transcriber } from "../transcriber/transcriber.ts";
import { classify, type Classification, type Due } from "../core/classify.ts";
import { answerQuery } from "../core/query.ts";
import { listTasks } from "../core/tasks.ts";
import { todayIn, wallClockToInstant } from "../time.ts";
import type { Tts } from "./tts.ts";
/** One event the agent emits while handling a voice message. */
export type RealtimeEvent =
  | { type: "transcript"; text: string }
  | { type: "response"; text: string }
  | { type: "audio"; audio: Buffer; mimeType: string }
  | { type: "error"; message: string };

export type RealtimeEmit = (event: RealtimeEvent) => Promise<void> | void;

export type RealtimeAgent = {
  /**
   * Transcribes the audio, classifies what the person said, acts on it, and speaks the response.
   * `ownerId` is the User the note/task/query belongs to.
   */
  handleAudio(audio: AudioSource, emit: RealtimeEmit, ownerId: ObjectId): Promise<void>;
};

export function createRealtimeAgent(deps: {
  database: Database;
  llm: Llm;
  inventory: InventoryClient;
  transcriber: Transcriber;
  tts: Tts;
  defaultTimezone: string;
  now?: () => Date;
}): RealtimeAgent {
  const { database, llm, inventory, transcriber, tts, defaultTimezone, now = () => new Date() } = deps;

  return {
    async handleAudio(audio, emit, ownerId) {
      /** 1. Transcribe the voice message into text. */
      let transcript: string;
      try {
        transcript = await transcriber.transcribe(audio);
      } catch (error) {
        await emit({ type: "error", message: "I didn't catch that. Could you say it again?" });
        return;
      }
      await emit({ type: "transcript", text: transcript });

      /** 2. Classify the transcript as a note, task, query, etc. */
      let classification: Classification;
      try {
        ({ value: classification } = await classify(llm, transcript, {
          today: todayIn(now(), defaultTimezone),
          timezone: defaultTimezone,
        }));
      } catch (error) {
        await emit({
          type: "error",
          message: "I'm having trouble understanding. Could you try again?",
        });
        return;
      }

      /** 3. Produce a spoken response based on the classification. */
      let response: { text: string };
      try {
        response = await respondTo(classification, transcript, {
          database,
          inventory,
          llm,
          ownerId,
          defaultTimezone,
          now,
        });
      } catch (error) {
        await emit({
          type: "error",
          message: "Something went wrong while processing that.",
        });
        return;
      }

      /** 4. Speak the response. */
      await emit({ type: "response", text: response.text });
      try {
        const spoken = await tts.speak(response.text);
        await emit({ type: "audio", audio: spoken, mimeType: "audio/wav" });
      } catch (error) {
        await emit({ type: "error", message: "I couldn't speak the response." });
      }
    },
  };
}

/** Turns one classification into a plain-language spoken response, acting on it where needed. */
async function respondTo(
  classification: Classification,
  transcript: string,
  deps: {
    database: Database;
    inventory: InventoryClient;
    llm: Llm;
    ownerId: ObjectId;
    defaultTimezone: string;
    now: () => Date;
  },
): Promise<{ text: string }> {
  const { database, ownerId, defaultTimezone, now } = deps;
  const user = await database.users.findOne({ _id: ownerId });
  const timezone = (user as UserDoc | null)?.timezone ?? defaultTimezone;

  switch (classification.kind) {
    case "note": {
      await database.notes.insertOne({
        ownerId,
        heading: classification.heading,
        text: transcript,
        transcript,
        source: { channel: "web", chatId: "realtime", messageId: "realtime" },
        createdAt: now(),
        updatedAt: now(),
      });
      return { text: `Saved your note "${classification.heading}".` };
    }

    case "task": {
      const dueText = classification.due === null ? "" : `, due ${dueInWords(classification.due)}`;
      const due = storedDue(classification.due, timezone);
      await database.tasks.insertOne({
        ownerId,
        heading: classification.heading,
        description: classification.description,
        due,
        status: "open",
        reminderSentAt: null,
        channelIdentity: { channel: "web", channelId: "realtime" },
        transcript,
        source: { channel: "web", chatId: "realtime", messageId: "realtime" },
        createdAt: now(),
        updatedAt: now(),
      });
      return { text: `Saved your task "${classification.heading}"${dueText}.` };
    }

    case "query": {
      const answer = await answerQuery({
        llm: deps.llm,
        inventory: deps.inventory,
        conversation: classification.conversation,
        first: classification.first,
      });
      return { text: answer };
    }

    case "greeting":
      return {
        text: "Hello! I'm your voice assistant. You can ask me to save notes, create tasks, or check your inventory.",
      };

    case "list-tasks": {
      const { tasks, more } = await listTasks(database, ownerId, timezone, classification.date);
      if (tasks.length === 0) {
        return { text: classification.date ? "You have no tasks due that day." : "You have no tasks." };
      }
      const listed = tasks
        .slice(0, 5)
        .map((t) => t.heading + (t.due ? `, due ${t.due.date}` : ""))
        .join(", ");
      return {
        text: `Your tasks: ${listed}.${more > 0 ? ` And ${more} more.` : ""}`,
      };
    }

    case "list-notes": {
      const notes = await database.notes
        .find({ ownerId })
        .sort({ createdAt: -1, _id: -1 })
        .limit(5)
        .toArray();
      if (notes.length === 0) return { text: "You have no notes." };
      return { text: `Your notes: ${notes.map((n) => n.heading).join(", ")}.` };
    }

    case "unclear":
      return {
        text: "I'm not sure whether that's a note, a task, or an inventory question. Could you tell me which?",
      };

    case "command":
      return { text: "Changing inventory data isn't supported yet." };

    case "change":
      return { text: "Editing existing items by voice isn't supported yet." };
  }
}

/** A date-only or moment due, read out in words. */
function dueInWords(due: NonNullable<Due>): string {
  if (due.time === undefined) return due.date;
  return `${due.date} at ${due.time}`;
}

function storedDue(due: Due | null, timezone: string): TaskDue | null {
  if (due === null) return null;
  if (due.time === undefined) return { kind: "date", date: due.date };
  return { kind: "moment", at: wallClockToInstant(due.date, due.time, timezone) };
}
