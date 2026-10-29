import type { FastifyInstance } from "fastify";
import type { ObjectId } from "mongodb";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createCore, type Core, type CoreEvent, type HandledMessage, type ListedNote } from "../src/core/core.ts";
import { createOpenRouter } from "../src/llm/openrouter.ts";
import { buildServer } from "../src/server.ts";
import { createTelegramBot, telegramWebhookHandler } from "../src/telegram/adapter.ts";
import { ensureFirstAdmin, findUserByChannelIdentity, hashPassword } from "../src/users.ts";
import { toolCall, useFakeOpenRouter } from "./fakes/fake-openrouter.ts";
import { useMemoryMongo } from "./fakes/memory-mongo.ts";
import { unusedInventory, unusedTranscriber } from "./fakes/unused.ts";

const MODEL = "test/model-a";

describe("core: asking to see my Notes", () => {
  const database = useMemoryMongo();
  const openRouter = useFakeOpenRouter();

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

  async function saveNote(ownerId: ObjectId, heading: string, savedAt: string) {
    await database().notes.insertOne({
      ownerId,
      heading,
      text: `${heading}, in full.`,
      transcript: heading,
      source: { channel: "telegram", chatId: "chat-42", messageId: heading },
      createdAt: new Date(savedAt),
      updatedAt: new Date(savedAt),
    });
  }

  async function ask(text = "show notes"): Promise<CoreEvent[]> {
    openRouter.script(MODEL, toolCall("list_notes", {}));
    const llm = createOpenRouter({ apiKey: "key", baseUrl: openRouter.baseUrl, models: [MODEL] });
    const core = createCore({ database: database(), llm, inventory: unusedInventory, transcriber: unusedTranscriber, defaultTimezone: "UTC" });
    const events: CoreEvent[] = [];
    await core.handleMessage(
      {
        sender: { channel: "telegram", channelId: "42" },
        chatId: "chat-42",
        messageId: "5001",
        content: { kind: "text", text },
        clarifyWith: "buttons",
      },
      async (event) => {
        events.push(event);
      },
    );
    return events;
  }

  it("lists every one of the User's Notes, newest first, saving nothing", async () => {
    const ownerId = await owner();
    await saveNote(ownerId, "Blue mugs are on shelf 3", "2026-10-27T08:00:00Z");
    await saveNote(ownerId, "Forklift key is in the top drawer", "2026-10-29T08:00:00Z");
    await saveNote(ownerId, "Dentist's new number", "2026-10-28T08:00:00Z");

    const events = await ask();

    expect(events).toEqual([
      { type: "processing-started" },
      {
        type: "result",
        result: {
          kind: "notes-listed",
          notes: [
            { heading: "Forklift key is in the top drawer", text: "Forklift key is in the top drawer, in full." },
            { heading: "Dentist's new number", text: "Dentist's new number, in full." },
            { heading: "Blue mugs are on shelf 3", text: "Blue mugs are on shelf 3, in full." },
          ],
        },
      },
    ]);
    expect(await database().notes.countDocuments()).toBe(3);
  });

  it("never lists another User's Notes", async () => {
    const ownerId = await owner();
    await saveNote(ownerId, "Blue mugs are on shelf 3", "2026-10-27T08:00:00Z");
    await saveNote(await someoneElse(), "Colleague's secret", "2026-10-28T08:00:00Z");

    const events = await ask("what are my notes?");

    expect(events.at(-1)).toEqual({
      type: "result",
      result: { kind: "notes-listed", notes: [{ heading: "Blue mugs are on shelf 3", text: "Blue mugs are on shelf 3, in full." }] },
    });
  });

  it("lists all of them however many there are", async () => {
    const ownerId = await owner();
    for (let i = 0; i < 45; i++) await saveNote(ownerId, `Note ${i}`, new Date(Date.UTC(2026, 9, 1, i)).toISOString());

    const events = await ask();

    const result = events.at(-1);
    expect(result?.type === "result" && result.result.kind === "notes-listed" && result.result.notes.length).toBe(45);
  });

  it("lists nothing when the User has no Notes", async () => {
    await owner();

    const events = await ask();

    expect(events.at(-1)).toEqual({ type: "result", result: { kind: "notes-listed", notes: [] } });
  });

  it("is recorded as a succeeded Run of type note-list", async () => {
    await owner();

    await ask();

    expect(await database().runs.findOne()).toMatchObject({ status: "succeeded", type: "note-list" });
  });

  it("offers the model a way to ask for the Notes", async () => {
    await owner();

    await ask();

    const tools = openRouter.requests[0]!.body.tools.map((tool: any) => tool.function.name);
    expect(tools).toContain("list_notes");
  });
});

describe("Telegram adapter: listing Notes", () => {
  let server: FastifyInstance;
  let apiCalls: Array<{ method: string; payload: any }>;
  let notes: ListedNote[];
  let handlingDone: Promise<void>;
  let finishHandling: () => void;

  beforeAll(async () => {
    const core: Core = {
      async handleMessage(_message, emit) {
        await emit({ type: "processing-started" });
        await emit({ type: "result", result: { kind: "notes-listed", notes } }, { processedBy: "openrouter" });
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
    handlingDone = new Promise((resolve) => {
      finishHandling = resolve;
    });
  });

  async function showNotes() {
    await server.inject({
      method: "POST",
      url: "/telegram/webhook",
      headers: { "x-telegram-bot-api-secret-token": "secret" },
      payload: {
        update_id: 1,
        message: {
          message_id: 55,
          date: 1_793_000_000,
          chat: { id: 42, type: "private", first_name: "Owner" },
          from: { id: 42, is_bot: false, first_name: "Owner" },
          text: "show notes",
        },
      },
    });
    await handlingDone;
  }

  it("shows each Note's heading and text in place of the processing reply", async () => {
    notes = [
      { heading: "Forklift key", text: "The forklift key is in the top drawer." },
      { heading: "Blue mugs", text: "The blue mugs are on shelf 3." },
    ];

    await showNotes();

    expect(apiCalls.map((call) => call.method)).toEqual(["sendMessage", "editMessageText"]);
    expect(apiCalls[1]!.payload.text).toBe(
      "Your Notes:\n\n" +
        "1. Forklift key\nThe forklift key is in the top drawer.\n\n" +
        "2. Blue mugs\nThe blue mugs are on shelf 3." +
        "\n\nProcessed by OpenRouter",
    );
  });

  it("says so when there are no Notes", async () => {
    notes = [];

    await showNotes();

    expect(apiCalls[1]!.payload.text).toBe("You have no Notes yet.\n\nProcessed by OpenRouter");
  });

  it("splits a list too long for one Telegram message across several, without losing any Note", async () => {
    notes = Array.from({ length: 40 }, (_, i) => ({ heading: `Note ${i + 1}`, text: "x".repeat(300) }));

    await showNotes();

    const texts: string[] = apiCalls.slice(1).map((call) => call.payload.text);
    expect(apiCalls[1]!.method).toBe("editMessageText");
    expect(apiCalls.slice(2).every((call) => call.method === "sendMessage")).toBe(true);
    expect(texts.length).toBeGreaterThan(1);
    expect(texts.every((text) => text.length <= 4096)).toBe(true);
    for (let i = 1; i <= 40; i++) expect(texts.join("\n")).toContain(`${i}. Note ${i}\n`);
    expect(texts.at(-1)).toMatch(/\n\nProcessed by OpenRouter$/);
    expect(texts.slice(0, -1).some((text) => text.includes("Processed by"))).toBe(false);
  });
});
