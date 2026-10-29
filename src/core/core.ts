import type { ChannelIdentity, Database } from "../db.ts";
import type { Llm } from "../llm/openrouter.ts";
import { findUserByChannelIdentity } from "../users.ts";
import { classify } from "./classify.ts";

/** A message from any Channel, in a channel-neutral shape (ADR 0005). */
export type InboundMessage = {
  sender: ChannelIdentity;
  chatId: string;
  messageId: string;
  content: { kind: "text"; text: string };
};

export type Result =
  | { kind: "note-saved"; heading: string }
  | { kind: "refused" }
  | { kind: "error" };

export type CoreEvent = { type: "processing-started" } | { type: "result"; result: Result };

export type EmitEvent = (event: CoreEvent) => Promise<void>;

export type Core = {
  handleMessage(message: InboundMessage, emit: EmitEvent): Promise<void>;
};

export function createCore(deps: { database: Database; llm: Llm }): Core {
  const { database, llm } = deps;

  return {
    async handleMessage(message, emit) {
      const user = await findUserByChannelIdentity(database, message.sender);
      if (!user) {
        await emit({ type: "result", result: { kind: "refused" } });
        return;
      }

      await emit({ type: "processing-started" });

      const transcript = message.content.text;
      let classification;
      try {
        classification = await classify(llm, transcript);
      } catch (error) {
        console.error("Classification failed", error);
        await emit({ type: "result", result: { kind: "error" } });
        return;
      }

      const now = new Date();
      await database.notes.insertOne({
        ownerId: user._id!,
        heading: classification.heading,
        text: transcript,
        transcript,
        source: { channel: message.sender.channel, chatId: message.chatId, messageId: message.messageId },
        createdAt: now,
        updatedAt: now,
      });

      await emit({ type: "result", result: { kind: "note-saved", heading: classification.heading } });
    },
  };
}
