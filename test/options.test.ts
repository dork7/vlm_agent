import { ObjectId } from "mongodb";
import { describe, expect, it } from "vitest";
import { createCore, type CoreEvent, type HandledMessage } from "../src/core/core.ts";
import { createOpenRouter } from "../src/llm/openrouter.ts";
import { ensureFirstAdmin, findUserByChannelIdentity } from "../src/users.ts";
import { useFakeOpenRouter } from "./fakes/fake-openrouter.ts";
import { useMemoryMongo } from "./fakes/memory-mongo.ts";
import { unusedInventory, unusedTranscriber } from "./fakes/unused.ts";

describe("core: a tapped Show Tasks or Show Notes button", () => {
  const database = useMemoryMongo();
  const openRouter = useFakeOpenRouter();

  async function saveItems() {
    await ensureFirstAdmin(database(), { username: "owner", password: "pw", telegramId: "42", timezone: "UTC" });
    const owner = (await findUserByChannelIdentity(database(), { channel: "telegram", channelId: "42" }))!._id!;
    const source = { channel: "telegram", chatId: "chat-42", messageId: "1" };
    const at = new Date("2026-11-01T09:00:00Z");
    await database().notes.insertMany([
      { ownerId: owner, heading: "Supplier contact", text: "Ahmed, ext 214.", transcript: "", source, createdAt: at, updatedAt: at },
      { ownerId: new ObjectId(), heading: "Someone else's note", text: "Secret.", transcript: "", source, createdAt: at, updatedAt: at },
    ]);
    await database().tasks.insertOne({
      ownerId: owner,
      heading: "Call the supplier",
      description: "Call the supplier about the pallets.",
      due: null,
      status: "open",
      reminderSentAt: null,
      channelIdentity: { channel: "telegram", channelId: "42" },
      transcript: "",
      source,
      createdAt: at,
      updatedAt: at,
    });
  }

  async function tap(what: "tasks" | "notes"): Promise<{ events: CoreEvent[]; handled: HandledMessage }> {
    const core = createCore({
      database: database(),
      llm: createOpenRouter({ apiKey: "key", baseUrl: openRouter.baseUrl, models: ["test/model-a"] }),
      transcriber: unusedTranscriber,
      inventory: unusedInventory,
      defaultTimezone: "UTC",
    });
    const events: CoreEvent[] = [];
    const handled = await core.handleMessage(
      {
        sender: { channel: "telegram", channelId: "42" },
        chatId: "chat-42",
        messageId: `callback:${what}`,
        content: { kind: "list", what },
        clarifyWith: "buttons",
      },
      async (event) => {
        events.push(event);
      },
    );
    return { events, handled };
  }

  it("lists the User's open Tasks without asking a model", async () => {
    await saveItems();

    const { events, handled } = await tap("tasks");

    expect(events).toEqual([
      { type: "result", result: { kind: "tasks-listed", tasks: [expect.objectContaining({ heading: "Call the supplier" })], more: 0, date: null } },
    ]);
    expect(openRouter.requests).toHaveLength(0);
    const run = (await database().runs.findOne({ _id: new ObjectId(handled.runId!) }))!;
    expect(run).toMatchObject({ status: "succeeded", type: "task-list", content: "list" });
  });

  it("lists only the User's own Notes without asking a model", async () => {
    await saveItems();

    const { events } = await tap("notes");

    expect(events).toEqual([
      { type: "result", result: { kind: "notes-listed", notes: [{ heading: "Supplier contact", text: "Ahmed, ext 214." }] } },
    ]);
    expect(openRouter.requests).toHaveLength(0);
  });
});
