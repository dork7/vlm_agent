import { describe, expect, it } from "vitest";
import { createCore, type CoreEvent, type InboundMessage } from "../src/core/core.ts";
import { createOpenRouter } from "../src/llm/openrouter.ts";
import { ensureFirstAdmin, findUserByChannelIdentity } from "../src/users.ts";
import { toolCall, useFakeOpenRouter } from "./fakes/fake-openrouter.ts";
import { useMemoryMongo } from "./fakes/memory-mongo.ts";
import { unusedInventory, unusedTranscriber } from "./fakes/unused.ts";

const MODEL = "test/model-a";

describe("core: a typed message", () => {
  const database = useMemoryMongo();
  const openRouter = useFakeOpenRouter();

  async function send(message: InboundMessage): Promise<CoreEvent[]> {
    await ensureFirstAdmin(database(), { username: "owner", password: "pw", telegramId: "42", timezone: "UTC" });
    const llm = createOpenRouter({ apiKey: "key", baseUrl: openRouter.baseUrl, models: [MODEL] });
    const core = createCore({ database: database(), llm, inventory: unusedInventory, transcriber: unusedTranscriber, defaultTimezone: "UTC" });
    const events: CoreEvent[] = [];
    await core.handleMessage(message, async (event) => {
      events.push(event);
    });
    return events;
  }

  const typed = (channel: string, senderId: string, text: string): InboundMessage => ({
    sender: { channel, channelId: senderId },
    chatId: `chat-${senderId}`,
    messageId: "1001",
    content: { kind: "text", text },
    clarifyWith: "buttons",
  });

  it("from a known Channel Identity becomes a Note named by its Heading", async () => {
    openRouter.script(MODEL, toolCall("save_note", { heading: "Oat milk is cheaper at the market" }));

    const events = await send(typed("telegram", "42", "Remember that oat milk is cheaper at the Saturday market"));

    expect(events).toEqual([
      { type: "processing-started" },
      { type: "result", result: { kind: "note-saved", heading: "Oat milk is cheaper at the market" } },
    ]);
    const owner = await findUserByChannelIdentity(database(), { channel: "telegram", channelId: "42" });
    const notes = await database().notes.find().toArray();
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({
      ownerId: owner!._id,
      heading: "Oat milk is cheaper at the market",
      text: "Remember that oat milk is cheaper at the Saturday market",
      transcript: "Remember that oat milk is cheaper at the Saturday market",
      source: { channel: "telegram", chatId: "chat-42", messageId: "1001" },
    });
  });

  it("sends the message text to the configured model", async () => {
    openRouter.script(MODEL, toolCall("save_note", { heading: "Call mum" }));

    await send(typed("telegram", "42", "Call mum about the weekend"));

    expect(openRouter.requests).toHaveLength(1);
    expect(JSON.stringify(openRouter.requests[0]!.body.messages)).toContain("Call mum about the weekend");
  });

  it("produces an error result and stores nothing when the model fails", async () => {
    openRouter.script(MODEL, { status: 503, body: { error: { message: "overloaded" } } });

    const events = await send(typed("telegram", "42", "Remember the dentist's new number"));

    expect(events).toEqual([{ type: "processing-started" }, { type: "result", result: { kind: "error" } }]);
    expect(await database().notes.countDocuments()).toBe(0);
  });

  it("produces an error result when the model's Note has no Heading", async () => {
    openRouter.script(MODEL, toolCall("save_note", { heading: "  " }));

    const events = await send(typed("telegram", "42", "Remember the dentist's new number"));

    expect(events.at(-1)).toEqual({ type: "result", result: { kind: "error" } });
    expect(await database().notes.countDocuments()).toBe(0);
  });

  it("from an unknown Channel Identity is refused and nothing is stored", async () => {
    const events = await send(typed("telegram", "999", "let me in"));

    expect(events).toEqual([{ type: "result", result: { kind: "refused" } }]);
    expect(await database().notes.countDocuments()).toBe(0);
    expect(openRouter.requests).toHaveLength(0);
  });

  it("is refused when the ID matches but on a different Channel", async () => {
    const events = await send(typed("whatsapp", "42", "hello"));

    expect(events).toEqual([{ type: "result", result: { kind: "refused" } }]);
    expect(await database().notes.countDocuments()).toBe(0);
  });
});
