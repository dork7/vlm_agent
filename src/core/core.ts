import type { ChannelIdentity, Database, TaskDue } from "../db.ts";
import type { Llm } from "../llm/openrouter.ts";
import { findUserByChannelIdentity } from "../users.ts";
import { todayIn, wallClockToInstant } from "../time.ts";
import { classify, type Due } from "./classify.ts";

export type { Due };

/** A message from any Channel, in a channel-neutral shape (ADR 0005). */
export type InboundMessage = {
  sender: ChannelIdentity;
  chatId: string;
  messageId: string;
  content: { kind: "text"; text: string };
};

export type Result =
  | { kind: "note-saved"; heading: string }
  /** `due` is the date and optional time on the User's own clock. */
  | { kind: "task-saved"; heading: string; due: Due }
  | { kind: "refused" }
  | { kind: "error" };

export type CoreEvent = { type: "processing-started" } | { type: "result"; result: Result };

export type EmitEvent = (event: CoreEvent) => Promise<void>;

export type Core = {
  handleMessage(message: InboundMessage, emit: EmitEvent): Promise<void>;
};

export function createCore(deps: {
  database: Database;
  llm: Llm;
  defaultTimezone: string;
  now?: () => Date;
}): Core {
  const { database, llm, defaultTimezone, now = () => new Date() } = deps;

  return {
    async handleMessage(message, emit) {
      const user = await findUserByChannelIdentity(database, message.sender);
      if (!user) {
        await emit({ type: "result", result: { kind: "refused" } });
        return;
      }

      await emit({ type: "processing-started" });

      const transcript = message.content.text;
      const timezone = user.timezone ?? defaultTimezone;
      let classification;
      try {
        classification = await classify(llm, transcript, {
          today: todayIn(now(), timezone),
          timezone,
        });
      } catch (error) {
        console.error("Classification failed", error);
        await emit({ type: "result", result: { kind: "error" } });
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
      await emit({
        type: "result",
        result: { kind: "task-saved", heading: classification.heading, due: classification.due },
      });
    },
  };
}

function storedDue(due: Due, timezone: string): TaskDue {
  if (due === null) return null;
  if (due.time === undefined) return { kind: "date", date: due.date };
  return { kind: "moment", at: wallClockToInstant(due.date, due.time, timezone) };
}
