import { describe, expect, it } from "vitest";
import { createCore, type ClarifyWith, type CoreEvent, type HandledMessage, type InboundMessage } from "../src/core/core.ts";
import type { InventoryClient } from "../src/inventory/client.ts";
import { createOpenRouter } from "../src/llm/openrouter.ts";
import { ensureFirstAdmin } from "../src/users.ts";
import { toolCall, useFakeOpenRouter } from "./fakes/fake-openrouter.ts";
import { useMemoryMongo } from "./fakes/memory-mongo.ts";
import { unusedInventory, unusedTranscriber } from "./fakes/unused.ts";

const MODEL = "test/model-a";
const UNCLEAR = "the supplier thing on Thursday";

/** An Inventory with one blue mug, answering without HTTP. */
const oneMugInventory: InventoryClient = {
  async lookup(lookup) {
    return {
      items: [{ sku: "SKU-01", name: "Blue mug", category: "Kitchen", quantity: 40, unitPrice: 6.5, location: "Warehouse A" }],
      request: { tool: lookup.tool, endpoint: "/inventory/items?name=mug", status: 200, latencyMs: 1 },
    };
  },
};

describe("core: a Clarification", () => {
  const database = useMemoryMongo();
  const openRouter = useFakeOpenRouter();
  let nextMessageId = 5000;

  async function send(
    content: InboundMessage["content"],
    options: { clarifyWith?: ClarifyWith; senderId?: string; chatId?: string; inventory?: InventoryClient; now?: Date } = {},
  ): Promise<{ events: CoreEvent[]; handled: HandledMessage }> {
    await ensureFirstAdmin(database(), { username: "owner", password: "pw", telegramId: "42", timezone: "UTC" });
    const core = createCore({
      database: database(),
      llm: createOpenRouter({ apiKey: "key", baseUrl: openRouter.baseUrl, models: [MODEL] }),
      inventory: options.inventory ?? unusedInventory,
      transcriber: unusedTranscriber,
      defaultTimezone: "UTC",
      now: () => options.now ?? new Date("2026-10-29T08:00:00Z"),
    });
    const senderId = options.senderId ?? "42";
    const events: CoreEvent[] = [];
    const handled = await core.handleMessage(
      {
        sender: { channel: "telegram", channelId: senderId },
        chatId: options.chatId ?? `chat-${senderId}`,
        messageId: String(nextMessageId++),
        content,
        clarifyWith: options.clarifyWith ?? "buttons",
      },
      async (event) => {
        events.push(event);
      },
    );
    return { events, handled };
  }

  const text = (words: string): InboundMessage["content"] => ({ kind: "text", text: words });

  /** Sends the unclear message and returns the Clarification's ID. */
  async function askUnclear(clarifyWith: ClarifyWith = "buttons"): Promise<string> {
    openRouter.script(MODEL, toolCall("ask_clarification", {}));
    const { events } = await send(text(UNCLEAR), { clarifyWith });
    const asked = events.at(-1);
    if (asked?.type !== "clarification-needed") throw new Error(`Expected a Clarification, got ${JSON.stringify(asked)}`);
    return asked.clarificationId;
  }

  const offeredTools = (request: number) =>
    openRouter.requests[request]!.body.tools.map((tool: { function: { name: string } }) => tool.function.name);

  it("is raised for an unclear message, offering Note, Task and Query, and nothing is saved yet", async () => {
    openRouter.script(MODEL, toolCall("ask_clarification", {}));

    const { events, handled } = await send(text(UNCLEAR));

    expect(events).toEqual([
      { type: "processing-started" },
      { type: "clarification-needed", clarificationId: expect.any(String), options: ["note", "task", "query"] },
    ]);
    expect(await database().notes.countDocuments()).toBe(0);
    expect(await database().tasks.countDocuments()).toBe(0);
    const asked = events[1] as { clarificationId: string };
    expect(handled.clarification).toEqual({ id: asked.clarificationId, outcome: "asked" });
    // Stored, so the Run can be shown as awaiting Clarification.
    expect(await database().clarifications.find().toArray()).toMatchObject([
      { transcript: UNCLEAR, status: "pending", answer: null, source: { chatId: "chat-42" } },
    ]);
  });

  it("answered Task, even weeks later, saves the original message as a Task with only Task filing offered", async () => {
    const clarificationId = await askUnclear();
    openRouter.script(MODEL, toolCall("save_task", { heading: "Call the supplier", description: "Call the supplier", due_date: "2026-10-29" }));

    const { events, handled } = await send(
      { kind: "clarification-answer", clarificationId, answer: "task" },
      { now: new Date("2026-11-20T08:00:00Z") },
    );

    expect(events).toEqual([
      { type: "processing-started" },
      { type: "result", result: { kind: "task-saved", heading: "Call the supplier", due: { date: "2026-10-29" } } },
    ]);
    expect(offeredTools(1)).toEqual(["save_task"]);
    expect(JSON.stringify(openRouter.requests[1]!.body.messages)).toContain(UNCLEAR);
    // The Task comes from the unclear message, not from the tap that answered it.
    const { source } = (await database().clarifications.findOne())!;
    expect(await database().tasks.find().toArray()).toMatchObject([{ transcript: UNCLEAR, source }]);
    expect(handled.clarification).toEqual({ id: clarificationId, outcome: "answered" });
    expect(await database().clarifications.findOne()).toMatchObject({
      status: "answered",
      answer: "task",
      answeredBy: String(nextMessageId - 1),
    });
  });

  it("answered Note saves the original message as a Note", async () => {
    const clarificationId = await askUnclear();
    openRouter.script(MODEL, toolCall("save_note", { heading: "The supplier thing" }));

    const { events } = await send({ kind: "clarification-answer", clarificationId, answer: "note" });

    expect(events.at(-1)).toEqual({ type: "result", result: { kind: "note-saved", heading: "The supplier thing" } });
    expect(offeredTools(1)).toEqual(["save_note"]);
    expect(await database().notes.find().toArray()).toMatchObject([{ text: UNCLEAR }]);
  });

  it("answered Query answers the original message from the Inventory", async () => {
    const clarificationId = await askUnclear();
    openRouter.script(MODEL, toolCall("search_items", { name: "mug" }));
    openRouter.script(MODEL, toolCall("answer_query", { answer: "You have 40 blue mugs." }));

    const { events, handled } = await send(
      { kind: "clarification-answer", clarificationId, answer: "query" },
      { inventory: oneMugInventory },
    );

    expect(events.at(-1)).toEqual({ type: "result", result: { kind: "query-answered", answer: "You have 40 blue mugs." } });
    expect(offeredTools(1)).toEqual(["search_items", "get_item"]);
    expect(handled.inventoryRequests).toHaveLength(1);
  });

  it.each([
    ["1", "save_note", "note-saved"],
    ["Note", "save_note", "note-saved"],
    ["a note", "save_note", "note-saved"],
    ["2", "save_task", "task-saved"],
    [" task. ", "save_task", "task-saved"],
  ])("on a text-only Channel, answered by typing %j, completes the message", async (reply, tool, kind) => {
    await askUnclear("text");
    openRouter.script(MODEL, toolCall(tool, { heading: "The supplier thing", description: "Call the supplier" }));

    const { events } = await send(text(reply), { clarifyWith: "text" });

    expect(events.at(-1)).toMatchObject({ type: "result", result: { kind } });
    expect(offeredTools(1)).toEqual([tool]);
  });

  it("on a text-only Channel, answered by typing 3, answers it as a Query", async () => {
    await askUnclear("text");
    openRouter.script(MODEL, toolCall("get_item", { sku: "SKU-01" }));
    openRouter.script(MODEL, toolCall("answer_query", { answer: "SKU-01 is the blue mug." }));

    const { events } = await send(text("3"), { clarifyWith: "text", inventory: oneMugInventory });

    expect(events.at(-1)).toEqual({ type: "result", result: { kind: "query-answered", answer: "SKU-01 is the blue mug." } });
  });

  it("on a text-only Channel, asks again after a reply that isn't an answer, and still accepts one", async () => {
    const clarificationId = await askUnclear("text");

    const again = await send(text("hmm, not sure"), { clarifyWith: "text" });

    expect(again.events).toEqual([{ type: "clarification-needed", clarificationId, options: ["note", "task", "query"] }]);
    expect(again.handled.clarification).toEqual({ id: clarificationId, outcome: "re-asked" });
    expect(openRouter.requests).toHaveLength(1);
    expect(await database().clarifications.findOne()).toMatchObject({ status: "pending" });

    openRouter.script(MODEL, toolCall("save_note", { heading: "The supplier thing" }));
    const answered = await send(text("1"), { clarifyWith: "text" });
    expect(answered.events.at(-1)).toMatchObject({ result: { kind: "note-saved" } });
  });

  it("on a text-only Channel, asks again after a Voice Message, without fetching it", async () => {
    const clarificationId = await askUnclear("text");
    let downloads = 0;

    const { events } = await send(
      { kind: "voice", durationSeconds: 4, download: async () => void downloads++ },
      { clarifyWith: "text" },
    );

    expect(events).toEqual([{ type: "clarification-needed", clarificationId, options: ["note", "task", "query"] }]);
    expect(downloads).toBe(0);
  });

  it("on a text-only Channel, leaves another User's pending Clarification in the same chat alone", async () => {
    await askUnclear("text");
    await database().users.insertOne({
      username: "colleague",
      password: { algorithm: "scrypt", salt: "", hash: "" },
      isAdmin: false,
      channelIdentities: [{ channel: "telegram", channelId: "77" }],
      createdAt: new Date(),
    });
    openRouter.script(MODEL, toolCall("save_note", { heading: "Number one" }));

    // Same chat as the owner's unclear message, e.g. a group.
    const { events } = await send(text("1"), { clarifyWith: "text", senderId: "77", chatId: "chat-42" });

    expect(events.at(-1)).toEqual({ type: "result", result: { kind: "note-saved", heading: "Number one" } });
    expect(await database().clarifications.findOne()).toMatchObject({ status: "pending" });
  });

  it("is pending again when completing it fails, so it can be answered again", async () => {
    const clarificationId = await askUnclear();
    openRouter.script(MODEL, { status: 500, body: { error: "down" } });

    const failed = await send({ kind: "clarification-answer", clarificationId, answer: "note" });

    expect(failed.events.at(-1)).toEqual({ type: "result", result: { kind: "error" } });
    expect(await database().clarifications.findOne()).toMatchObject({ status: "pending", answer: null, answeredBy: null });

    openRouter.script(MODEL, toolCall("save_note", { heading: "The supplier thing" }));
    const retried = await send({ kind: "clarification-answer", clarificationId, answer: "note" });
    expect(retried.events.at(-1)).toMatchObject({ result: { kind: "note-saved" } });
  });

  it("on a Channel with buttons, treats a typed message as a new one while a Clarification is pending", async () => {
    await askUnclear("buttons");
    openRouter.script(MODEL, toolCall("save_note", { heading: "Oat milk is cheaper" }));

    const { events } = await send(text("1"), { clarifyWith: "buttons" });

    expect(events.at(-1)).toEqual({ type: "result", result: { kind: "note-saved", heading: "Oat milk is cheaper" } });
    expect(await database().notes.find().toArray()).toMatchObject([{ text: "1" }]);
    expect(await database().clarifications.findOne()).toMatchObject({ status: "pending" });
  });

  it("is completed only once when answered twice", async () => {
    const clarificationId = await askUnclear();
    openRouter.script(MODEL, toolCall("save_note", { heading: "The supplier thing" }));
    await send({ kind: "clarification-answer", clarificationId, answer: "note" });

    const { events } = await send({ kind: "clarification-answer", clarificationId, answer: "task" });

    expect(events).toEqual([]);
    expect(await database().notes.countDocuments()).toBe(1);
    expect(await database().tasks.countDocuments()).toBe(0);
  });

  it("can't be answered by another User", async () => {
    const clarificationId = await askUnclear();
    await database().users.insertOne({
      username: "colleague",
      password: { algorithm: "scrypt", salt: "", hash: "" },
      isAdmin: false,
      channelIdentities: [{ channel: "telegram", channelId: "77" }],
      createdAt: new Date(),
    });

    const { events } = await send({ kind: "clarification-answer", clarificationId, answer: "note" }, { senderId: "77" });

    expect(events).toEqual([]);
    expect(await database().clarifications.findOne()).toMatchObject({ status: "pending" });
  });
});
