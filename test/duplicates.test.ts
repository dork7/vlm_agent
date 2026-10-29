import { describe, expect, it } from "vitest";
import { createCore, type CoreEvent, type InboundMessage } from "../src/core/core.ts";
import { createOpenRouter } from "../src/llm/openrouter.ts";
import { ensureFirstAdmin } from "../src/users.ts";
import { toolCall, useFakeOpenRouter } from "./fakes/fake-openrouter.ts";
import { useMemoryMongo } from "./fakes/memory-mongo.ts";
import { unusedInventory, unusedTranscriber } from "./fakes/unused.ts";

const MODEL = "test/model-a";

describe("core: a message delivered more than once", () => {
  const database = useMemoryMongo();
  const openRouter = useFakeOpenRouter();

  /** A fresh core each time, as after a restart; only MongoDB is shared. */
  async function deliver(message: InboundMessage) {
    await ensureFirstAdmin(database(), { username: "owner", password: "pw", telegramId: "42", timezone: "UTC" });
    const core = createCore({
      database: database(),
      llm: createOpenRouter({ apiKey: "key", baseUrl: openRouter.baseUrl, models: [MODEL] }),
      inventory: unusedInventory,
      transcriber: unusedTranscriber,
      defaultTimezone: "UTC",
    });
    const events: CoreEvent[] = [];
    const handled = await core.handleMessage(message, async (event) => {
      events.push(event);
    });
    return { events, handled };
  }

  const message = (overrides: Partial<InboundMessage> = {}): InboundMessage => ({
    sender: { channel: "telegram", channelId: "42" },
    chatId: "chat-42",
    messageId: "3003",
    content: { kind: "text", text: "Remember the dentist's new number" },
    clarifyWith: "buttons",
    ...overrides,
  });

  it("is handled once: one saved Note, one result, and the second delivery ignored even after a restart", async () => {
    openRouter.script(MODEL, toolCall("save_note", { heading: "Dentist's new number" }));
    openRouter.script(MODEL, toolCall("save_note", { heading: "Should not be asked" }));

    const first = await deliver(message());
    const second = await deliver(message());

    expect(first.events.at(-1)).toEqual({ type: "result", result: { kind: "note-saved", heading: "Dentist's new number" } });
    expect(second.events).toEqual([]);
    expect(second.handled.duplicate).toBe(true);
    expect(first.handled.duplicate).toBe(false);
    expect(openRouter.requests).toHaveLength(1);
    expect(await database().notes.countDocuments()).toBe(1);
  });

  it("is told apart by Channel, chat and Channel message ID together", async () => {
    for (let i = 0; i < 3; i++) openRouter.script(MODEL, toolCall("save_note", { heading: `Note ${i}` }));

    await deliver(message());
    const otherMessage = await deliver(message({ messageId: "3004" }));
    const otherChat = await deliver(message({ chatId: "chat-77" }));

    expect(otherMessage.handled.duplicate).toBe(false);
    expect(otherChat.handled.duplicate).toBe(false);
    expect(await database().notes.countDocuments()).toBe(3);
  });

  it("is handled once when both deliveries arrive at the same time", async () => {
    openRouter.script(MODEL, toolCall("save_note", { heading: "Dentist's new number" }));
    openRouter.script(MODEL, toolCall("save_note", { heading: "Should not be asked" }));

    const results = await Promise.all([deliver(message()), deliver(message())]);

    expect(results.map((result) => result.handled.duplicate).sort()).toEqual([false, true]);
    expect(await database().notes.countDocuments()).toBe(1);
  });
});
