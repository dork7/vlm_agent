import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createCore, type Core, type CoreEvent, type HandledMessage } from "../src/core/core.ts";
import { createOpenRouter } from "../src/llm/openrouter.ts";
import { buildServer } from "../src/server.ts";
import { createTelegramBot, telegramWebhookHandler } from "../src/telegram/adapter.ts";
import { ensureFirstAdmin } from "../src/users.ts";
import { toolCall, useFakeOpenRouter } from "./fakes/fake-openrouter.ts";
import { useMemoryMongo } from "./fakes/memory-mongo.ts";
import { unusedInventory, unusedTranscriber } from "./fakes/unused.ts";

const MODEL = "test/model-a";

describe("core: a greeting", () => {
  const database = useMemoryMongo();
  const openRouter = useFakeOpenRouter();

  async function send(text: string): Promise<CoreEvent[]> {
    await ensureFirstAdmin(database(), { username: "owner", password: "pw", telegramId: "42", timezone: "Asia/Dubai" });
    openRouter.script(MODEL, toolCall("greet", {}));
    const llm = createOpenRouter({ apiKey: "key", baseUrl: openRouter.baseUrl, models: [MODEL] });
    const core = createCore({ database: database(), llm, inventory: unusedInventory, transcriber: unusedTranscriber, defaultTimezone: "UTC" });
    const events: CoreEvent[] = [];
    await core.handleMessage(
      {
        sender: { channel: "telegram", channelId: "42" },
        chatId: "chat-42",
        messageId: "4001",
        content: { kind: "text", text },
        clarifyWith: "buttons",
      },
      async (event) => {
        events.push(event);
      },
    );
    return events;
  }

  it("is answered with a greeting, saving nothing", async () => {
    const events = await send("hi there");

    expect(events).toEqual([{ type: "processing-started" }, { type: "result", result: { kind: "greeted" } }]);
    expect(await database().notes.countDocuments()).toBe(0);
    expect(await database().tasks.countDocuments()).toBe(0);
    expect(await database().clarifications.countDocuments()).toBe(0);
  });

  it("is recorded as a succeeded Run of type greeting", async () => {
    await send("hello");

    const [run] = await database().runs.find().toArray();
    expect(run).toMatchObject({ status: "succeeded", type: "greeting" });
  });

  it("offers the model a way to recognise a greeting", async () => {
    await send("good morning");

    const tools = openRouter.requests[0]!.body.tools.map((tool: any) => tool.function.name);
    expect(tools).toContain("greet");
  });
});

describe("Telegram adapter: a greeting", () => {
  let server: FastifyInstance;
  const apiCalls: Array<{ method: string; payload: any }> = [];
  let handlingDone: Promise<void>;

  beforeAll(async () => {
    let finishHandling!: () => void;
    handlingDone = new Promise((resolve) => {
      finishHandling = resolve;
    });
    const core: Core = {
      async handleMessage(_message, emit) {
        await emit({ type: "processing-started" });
        await emit({ type: "result", result: { kind: "greeted" } }, { processedBy: "local" });
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

  it("says hi and lists what the bot can do, in place of the processing reply", async () => {
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
          text: "hi",
        },
      },
    });
    await handlingDone;

    expect(apiCalls.map((call) => call.method)).toEqual(["sendMessage", "editMessageText"]);
    const reply: string = apiCalls[1]!.payload.text;
    expect(reply).toMatch(/^Hi!/);
    for (const feature of ["Note", "Task", "Reminder", "show tasks", "Inventory", "Voice Message"]) {
      expect(reply).toContain(feature);
    }
    // The core said a local model processed it.
    expect(reply).toMatch(/\n\nProcessed by local AI$/);
  });
});
