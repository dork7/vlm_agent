import type { FastifyInstance } from "fastify";
import type { ObjectId } from "mongodb";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  createCore,
  type ClarifyWith,
  type Core,
  type CoreEvent,
  type HandledMessage,
  type InboundMessage,
} from "../src/core/core.ts";
import type { TaskDue } from "../src/db.ts";
import { createOpenRouter } from "../src/llm/openrouter.ts";
import { buildServer } from "../src/server.ts";
import { createTelegramBot, telegramWebhookHandler } from "../src/telegram/adapter.ts";
import { ensureFirstAdmin, findUserByChannelIdentity, hashPassword } from "../src/users.ts";
import { toolCall, useFakeOpenRouter } from "./fakes/fake-openrouter.ts";
import { useMemoryMongo } from "./fakes/memory-mongo.ts";
import { unusedInventory, unusedTranscriber } from "./fakes/unused.ts";

const MODEL = "test/model-a";
// 10:00 on Saturday 31 October in Dubai (UTC+4).
const NOW = new Date("2026-10-31T06:00:00Z");

describe("core: changing a Note or Task from the chat", () => {
  const database = useMemoryMongo();
  const openRouter = useFakeOpenRouter();
  let messageNumber = 0;

  async function owner(): Promise<ObjectId> {
    await ensureFirstAdmin(database(), { username: "owner", password: "pw", telegramId: "42", timezone: "Asia/Dubai" });
    return (await findUserByChannelIdentity(database(), { channel: "telegram", channelId: "42" }))!._id!;
  }

  async function someoneElse(): Promise<ObjectId> {
    const { insertedId } = await database().users.insertOne({
      username: "colleague",
      password: hashPassword("pw"),
      isAdmin: false,
      timezone: "Asia/Dubai",
      channelIdentities: [{ channel: "telegram", channelId: "77" }],
      createdAt: new Date(),
    });
    return insertedId;
  }

  async function saveTask(ownerId: ObjectId, heading: string, due: TaskDue = null): Promise<string> {
    const { insertedId } = await database().tasks.insertOne({
      ownerId,
      heading,
      description: `${heading}, in full.`,
      due,
      status: "open",
      reminderSentAt: new Date("2026-10-30T05:00:00Z"),
      channelIdentity: { channel: "telegram", channelId: "42" },
      transcript: heading,
      source: { channel: "telegram", chatId: "chat-42", messageId: heading },
      createdAt: NOW,
      updatedAt: NOW,
    });
    return insertedId.toHexString();
  }

  async function saveNote(ownerId: ObjectId, heading: string): Promise<string> {
    const { insertedId } = await database().notes.insertOne({
      ownerId,
      heading,
      text: `${heading}, in full.`,
      transcript: heading,
      source: { channel: "telegram", chatId: "chat-42", messageId: heading },
      createdAt: NOW,
      updatedAt: NOW,
    });
    return insertedId.toHexString();
  }

  function core(): Core {
    const llm = createOpenRouter({ apiKey: "key", baseUrl: openRouter.baseUrl, models: [MODEL] });
    return createCore({
      database: database(),
      llm,
      inventory: unusedInventory,
      transcriber: unusedTranscriber,
      defaultTimezone: "UTC",
      now: () => NOW,
    });
  }

  async function send(
    content: InboundMessage["content"],
    options: { sender?: string; clarifyWith?: ClarifyWith } = {},
  ): Promise<{ events: CoreEvent[]; handled: HandledMessage }> {
    const events: CoreEvent[] = [];
    const handled = await core().handleMessage(
      {
        sender: { channel: "telegram", channelId: options.sender ?? "42" },
        chatId: "chat-42",
        messageId: `m-${messageNumber++}`,
        content,
        clarifyWith: options.clarifyWith ?? "buttons",
      },
      async (event) => {
        events.push(event);
      },
    );
    return { events, handled };
  }

  /** The model reads the message as a change, then proposes this one. */
  async function ask(text: string, proposal: Record<string, unknown> | null, options: { clarifyWith?: ClarifyWith } = {}) {
    openRouter.script(MODEL, toolCall("change_item", {}));
    openRouter.script(MODEL, proposal === null ? toolCall("item_not_found", {}) : toolCall("propose_change", proposal));
    return send({ kind: "text", text }, options);
  }

  function proposed(events: CoreEvent[]) {
    const event = events.at(-1)!;
    if (event.type !== "change-proposed") throw new Error(`Expected a proposed change, got ${JSON.stringify(event)}`);
    return event;
  }

  const confirm = (changeId: string, confirmed = true, sender?: string) =>
    send({ kind: "change-answer", changeId, confirm: confirmed }, sender ? { sender } : {});

  it("shows the Task as it is and as it would be, changing nothing until confirmed", async () => {
    const ownerId = await owner();
    const taskId = await saveTask(ownerId, "Call the supplier", { kind: "date", date: "2026-11-01" });

    const { events } = await ask("move the supplier call to Monday at 3pm", {
      item_id: taskId,
      action: "edit",
      due_date: "2026-11-02",
      due_time: "15:00",
    });

    expect(proposed(events)).toEqual({
      type: "change-proposed",
      changeId: expect.any(String),
      action: "edit",
      before: { kind: "task", heading: "Call the supplier", description: "Call the supplier, in full.", due: { date: "2026-11-01" }, status: "open" },
      after: {
        kind: "task",
        heading: "Call the supplier",
        description: "Call the supplier, in full.",
        due: { date: "2026-11-02", time: "15:00" },
        status: "open",
      },
    });
    expect((await database().tasks.findOne())!.due).toEqual({ kind: "date", date: "2026-11-01" });
  });

  it("applies a confirmed due date change and re-arms the Task's Reminder", async () => {
    const ownerId = await owner();
    const taskId = await saveTask(ownerId, "Call the supplier", { kind: "date", date: "2026-11-01" });
    const { events } = await ask("move the supplier call to Monday at 3pm", {
      item_id: taskId,
      action: "edit",
      due_date: "2026-11-02",
      due_time: "15:00",
    });

    const answer = await confirm(proposed(events).changeId);

    expect(answer.events.at(-1)).toEqual({
      type: "result",
      result: { kind: "change-applied", action: "edit", itemKind: "task", heading: "Call the supplier" },
    });
    const task = (await database().tasks.findOne())!;
    // 15:00 in Dubai is 11:00 UTC.
    expect(task.due).toEqual({ kind: "moment", at: new Date("2026-11-02T11:00:00Z") });
    expect(task.reminderSentAt).toBeNull();
  });

  it("edits a Note's heading and text once confirmed", async () => {
    const ownerId = await owner();
    const noteId = await saveNote(ownerId, "Blue mugs on shelf 3");
    const { events } = await ask("the blue mugs moved to shelf 4", {
      item_id: noteId,
      action: "edit",
      heading: "Blue mugs on shelf 4",
      text: "The blue mugs are on shelf 4.",
    });
    expect(proposed(events).after).toEqual({ kind: "note", heading: "Blue mugs on shelf 4", text: "The blue mugs are on shelf 4." });

    await confirm(proposed(events).changeId);

    expect(await database().notes.findOne()).toMatchObject({ heading: "Blue mugs on shelf 4", text: "The blue mugs are on shelf 4." });
  });

  it("marks a Task done, and reopens it, once confirmed", async () => {
    const ownerId = await owner();
    const taskId = await saveTask(ownerId, "Call the supplier");

    const done = await ask("I called the supplier", { item_id: taskId, action: "done" });
    expect(proposed(done.events).after).toMatchObject({ status: "done" });
    await confirm(proposed(done.events).changeId);
    expect((await database().tasks.findOne())!.status).toBe("done");

    const reopen = await ask("actually I still need to call the supplier", { item_id: taskId, action: "reopen" });
    await confirm(proposed(reopen.events).changeId);
    expect((await database().tasks.findOne())!.status).toBe("open");
  });

  it("deletes an item only once confirmed, showing nothing as its after", async () => {
    const ownerId = await owner();
    const noteId = await saveNote(ownerId, "Forklift key location");
    const { events } = await ask("delete the forklift note", { item_id: noteId, action: "delete" });
    expect(proposed(events)).toMatchObject({ action: "delete", after: null });
    expect(await database().notes.countDocuments()).toBe(1);

    const answer = await confirm(proposed(events).changeId);

    expect(answer.events.at(-1)).toEqual({
      type: "result",
      result: { kind: "change-applied", action: "delete", itemKind: "note", heading: "Forklift key location" },
    });
    expect(await database().notes.countDocuments()).toBe(0);
  });

  it("changes nothing when the User cancels", async () => {
    const ownerId = await owner();
    const noteId = await saveNote(ownerId, "Forklift key location");
    const { events } = await ask("delete the forklift note", { item_id: noteId, action: "delete" });

    const answer = await confirm(proposed(events).changeId, false);

    expect(answer.events.at(-1)).toEqual({ type: "result", result: { kind: "change-cancelled" } });
    expect(await database().notes.countDocuments()).toBe(1);
  });

  it("applies a change only once, and only for the User who asked for it", async () => {
    const ownerId = await owner();
    await someoneElse();
    const noteId = await saveNote(ownerId, "Forklift key location");
    const { events } = await ask("delete the forklift note", { item_id: noteId, action: "delete" });
    const { changeId } = proposed(events);

    const stranger = await confirm(changeId, true, "77");
    expect(stranger.events.at(-1)).toEqual({ type: "result", result: { kind: "item-not-found" } });
    expect(await database().notes.countDocuments()).toBe(1);

    await confirm(changeId);
    const again = await confirm(changeId);
    expect(again.events.at(-1)).toEqual({ type: "result", result: { kind: "item-not-found" } });
  });

  it("never offers to change another User's item", async () => {
    await owner();
    const theirs = await saveNote(await someoneElse(), "Colleague's secret");

    const { events } = await ask("delete the secret note", { item_id: theirs, action: "delete" });

    expect(events.at(-1)).toEqual({ type: "result", result: { kind: "item-not-found" } });
    expect(await database().changes.countDocuments()).toBe(0);
  });

  it("says so when the model can't find the item", async () => {
    const ownerId = await owner();
    await saveNote(ownerId, "Forklift key location");

    const { events } = await ask("delete the note about the van", null);

    expect(events.at(-1)).toEqual({ type: "result", result: { kind: "item-not-found" } });
  });

  it("gives the model the User's own Notes and Tasks to choose from, and none of anyone else's", async () => {
    const ownerId = await owner();
    const taskId = await saveTask(ownerId, "Call the supplier");
    const noteId = await saveNote(ownerId, "Forklift key location");
    await saveNote(await someoneElse(), "Colleague's secret");

    await ask("delete the forklift note", { item_id: noteId, action: "delete" });

    const resolution = JSON.stringify(openRouter.requests[1]!.body.messages);
    expect(resolution).toContain(taskId);
    expect(resolution).toContain("Call the supplier");
    expect(resolution).toContain(noteId);
    expect(resolution).not.toContain("Colleague's secret");
  });

  it("tells the classifier the headings of the User's own Notes and Tasks, so a change to one isn't saved as new", async () => {
    const ownerId = await owner();
    await saveTask(ownerId, "Call the supplier");
    await saveNote(ownerId, "Blue mugs on shelf 3");
    await saveNote(await someoneElse(), "Colleague's secret");

    await ask("move the supplier call to Monday", null);

    const classification = JSON.stringify(openRouter.requests[0]!.body.messages);
    expect(classification).toContain("Call the supplier");
    expect(classification).toContain("Blue mugs on shelf 3");
    expect(classification).not.toContain("Colleague's secret");
  });

  it("takes a typed yes or no as the answer on a Channel without buttons", async () => {
    const ownerId = await owner();
    const noteId = await saveNote(ownerId, "Forklift key location");
    await ask("delete the forklift note", { item_id: noteId, action: "delete" }, { clarifyWith: "text" });

    const answer = await send({ kind: "text", text: "Yes" }, { clarifyWith: "text" });

    expect(answer.events.at(-1)).toMatchObject({ result: { kind: "change-applied", action: "delete" } });
    expect(await database().notes.countDocuments()).toBe(0);
    // The model was asked only about the original message, not the "yes".
    expect(openRouter.requests).toHaveLength(2);
  });

  it("records the request as a change Run with its own resolution stage, and the answer as a Run with no type", async () => {
    const ownerId = await owner();
    const noteId = await saveNote(ownerId, "Forklift key location");
    const { events } = await ask("delete the forklift note", { item_id: noteId, action: "delete" });
    await confirm(proposed(events).changeId);

    const [request, answer] = await database().runs.find().sort({ startedAt: 1, _id: 1 }).toArray();
    expect(request).toMatchObject({ status: "succeeded", type: "change" });
    expect(request!.stages.map((stage) => stage.name)).toEqual(["received", "classification", "change-resolution", "reply"]);
    expect(answer).toMatchObject({ status: "succeeded", type: null, content: "change-answer" });
  });
});

describe("Telegram adapter: a proposed change", () => {
  let server: FastifyInstance;
  let apiCalls: Array<{ method: string; payload: any }>;
  let received: InboundMessage[];
  let script: CoreEvent[];
  let handlingDone: Promise<void>;
  let finishHandling: () => void;
  const CHANGE_ID = "6720a1b2c3d4e5f6a7b8c9d0";

  beforeAll(async () => {
    const core: Core = {
      async handleMessage(message, emit) {
        received.push(message);
        for (const event of script) await emit(event, { processedBy: "openrouter" });
        finishHandling();
        return { duplicate: false, transcription: null, modelAttempts: [], inventoryRequests: [], clarification: null, runId: null } satisfies HandledMessage;
      },
      sendDueReminders: async () => {},
      completeTask: async () => ({ kind: "task-not-found" }),
    };
    const bot = createTelegramBot("123:test-token", core, {
      botInfo: {
        id: 123,
        is_bot: true,
        first_name: "Test bot",
        username: "test_bot",
        can_join_groups: false,
        can_read_all_group_messages: false,
        supports_inline_queries: false,
        can_connect_to_business: false,
        has_main_web_app: false,
        has_topics_enabled: false,
        allows_users_to_create_topics: false,
        can_manage_bots: false,
        supports_join_request_queries: false,
      },
    });
    // No real Telegram: Bot API calls are recorded and answered locally.
    bot.api.config.use(async (_prev, method, payload) => {
      apiCalls.push({ method, payload });
      const result = method === "sendMessage" ? { message_id: 900, date: 0, chat: { id: 42, type: "private" } } : true;
      return { ok: true, result } as never;
    });
    server = buildServer({
      logger: false,
      inventory: { items: [], apiKey: "unused" },
      webhook: { path: "/telegram/webhook", handler: telegramWebhookHandler(bot, "secret") },
    });
    await server.ready();
  });
  afterAll(() => server.close());

  beforeEach(() => {
    apiCalls = [];
    received = [];
    handlingDone = new Promise((resolve) => {
      finishHandling = resolve;
    });
  });

  const post = (update: object) =>
    server.inject({
      method: "POST",
      url: "/telegram/webhook",
      headers: { "x-telegram-bot-api-secret-token": "secret" },
      payload: update,
    });

  it("shows the item now and after, with Confirm and Cancel buttons", async () => {
    script = [
      { type: "processing-started" },
      {
        type: "change-proposed",
        changeId: CHANGE_ID,
        action: "edit",
        before: { kind: "task", heading: "Call the supplier", description: "About the invoice.", due: { date: "2026-11-01" }, status: "open" },
        after: { kind: "task", heading: "Call the supplier", description: "About the invoice.", due: { date: "2026-11-02", time: "15:00" }, status: "open" },
      },
    ];

    await post({
      update_id: 1,
      message: {
        message_id: 55,
        date: 1_793_000_000,
        chat: { id: 42, type: "private", first_name: "Owner" },
        from: { id: 42, is_bot: false, first_name: "Owner" },
        text: "move the supplier call to Monday at 3pm",
      },
    });
    await handlingDone;

    expect(apiCalls[1]).toMatchObject({
      method: "editMessageText",
      payload: {
        text:
          "Change this Task?\n\n" +
          "Now:\nCall the supplier (due Sun 1 Nov 2026)\nAbout the invoice.\n\n" +
          "After:\nCall the supplier (due Mon 2 Nov 2026, 15:00)\nAbout the invoice." +
          "\n\nProcessed by OpenRouter",
        reply_markup: {
          inline_keyboard: [
            [
              { text: "Confirm", callback_data: `change:${CHANGE_ID}:yes` },
              { text: "Cancel", callback_data: `change:${CHANGE_ID}:no` },
            ],
          ],
        },
      },
    });
  });

  it("asks to confirm a delete showing only the item", async () => {
    script = [
      {
        type: "change-proposed",
        changeId: CHANGE_ID,
        action: "delete",
        before: { kind: "note", heading: "Forklift key", text: "In the top drawer." },
        after: null,
      },
    ];

    await post({
      update_id: 2,
      message: {
        message_id: 56,
        date: 1_793_000_000,
        chat: { id: 42, type: "private", first_name: "Owner" },
        from: { id: 42, is_bot: false, first_name: "Owner" },
        text: "delete the forklift note",
      },
    });
    await handlingDone;

    expect(apiCalls.at(-1)!.payload.text).toBe("Delete this Note?\n\nForklift key\nIn the top drawer.\n\nProcessed by OpenRouter");
    expect(apiCalls.at(-1)!.payload.reply_markup.inline_keyboard[0][0]).toEqual({ text: "Delete", callback_data: `change:${CHANGE_ID}:yes` });
  });

  it("sends a tapped button to the core as the answer, editing the question into the result", async () => {
    script = [
      { type: "processing-started" },
      { type: "result", result: { kind: "change-applied", action: "delete", itemKind: "note", heading: "Forklift key" } },
    ];

    await post({
      update_id: 3,
      callback_query: {
        id: "cb-1",
        chat_instance: "ci",
        from: { id: 42, is_bot: false, first_name: "Owner" },
        message: { message_id: 900, date: 0, chat: { id: 42, type: "private", first_name: "Owner" }, text: "Delete this Note?" },
        data: `change:${CHANGE_ID}:yes`,
      },
    });
    await handlingDone;

    expect(received[0]!.content).toEqual({ kind: "change-answer", changeId: CHANGE_ID, confirm: true });
    expect(apiCalls.at(-1)).toMatchObject({
      method: "editMessageText",
      payload: { message_id: 900, text: "Deleted Note: Forklift key\n\nProcessed by OpenRouter" },
    });
  });
});
