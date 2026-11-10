import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createCore, type Core, type CoreEvent, type HandledMessage, type InboundMessage } from "../src/core/core.ts";
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
  const received: InboundMessage[] = [];
  let finishHandling!: () => void;
  let handlingDone: Promise<void>;
  /** Waits for the next message the stub core handles. */
  const nextHandling = () => {
    handlingDone = new Promise((resolve) => {
      finishHandling = resolve;
    });
  };

  beforeAll(async () => {
    nextHandling();
    const core: Core = {
      async handleMessage(message, emit) {
        received.push(message);
        if (message.content.kind === "list") {
          await emit({ type: "result", result: { kind: "notes-listed", notes: [] } });
        } else {
          await emit({ type: "processing-started" });
          await emit({ type: "result", result: { kind: "greeted" } }, { processedBy: "local", model: "llama-3.2-3b" });
        }
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

  const post = (payload: object) =>
    server.inject({
      method: "POST",
      url: "/telegram/webhook",
      headers: { "x-telegram-bot-api-secret-token": "secret" },
      payload: { update_id: Math.floor(Math.random() * 1e9), ...payload },
    });
  const chat = { id: 42, type: "private", first_name: "Owner" };
  const from = { id: 42, is_bot: false, first_name: "Owner" };
  /** The labels and data of the buttons under a reply, row by row flattened. */
  const buttonsOf = (payload: any): Array<[string, string]> =>
    payload.reply_markup.inline_keyboard.flat().map((button: any) => [button.text, button.callback_data]);
  const GREETING_BUTTONS = [
    ["Add Note", "hint:note"],
    ["Add Task", "hint:task"],
    ["Research", "hint:research"],
    ["Something else", "hint:other"],
  ];

  it("says hi briefly, in place of the processing reply, with buttons for what to do next", async () => {
    apiCalls.length = 0;
    await post({ message: { message_id: 55, date: 1_793_000_000, chat, from, text: "hi" } });
    await handlingDone;

    expect(apiCalls.map((call) => call.method)).toEqual(["sendMessage", "editMessageText"]);
    const reply: string = apiCalls[1]!.payload.text;
    expect(reply).toMatch(/^Hi!/);
    for (const feature of ["Note", "Task", "research", "Voice Message"]) {
      expect(reply).toContain(feature);
    }
    expect(reply.replace(/\n\nProcessed by .*$/, "")).not.toContain("\n");
    // The core said a local model processed it.
    expect(reply).toMatch(/\n\nProcessed by local AI \(llama-3\.2-3b\)$/);
    expect(buttonsOf(apiCalls[1]!.payload)).toEqual(GREETING_BUTTONS);
  });

  it("greets with the same buttons on /start", async () => {
    apiCalls.length = 0;
    await post({
      message: { message_id: 56, date: 1_793_000_000, chat, from, text: "/start", entities: [{ type: "bot_command", offset: 0, length: 6 }] },
    });

    expect(apiCalls.map((call) => call.method)).toEqual(["sendMessage"]);
    expect(apiCalls[0]!.payload.text).toMatch(/^Hi!/);
    expect(buttonsOf(apiCalls[0]!.payload)).toEqual(GREETING_BUTTONS);
  });

  it.each([
    ["note", /Note.*e\.g\./s],
    ["task", /Task.*due.*e\.g\./s],
    ["research", /find out.*web.*Notes and Tasks/s],
    ["other", /Tell me what you need/],
  ])("answers a tapped %s button with a hint of what to send", async (button, hint) => {
    apiCalls.length = 0;
    await post({
      callback_query: {
        id: `cb-${button}`,
        chat_instance: "ci",
        from,
        message: { message_id: 900, date: 1_793_000_000, chat, text: "Hi!" },
        data: `hint:${button}`,
      },
    });

    expect(apiCalls.map((call) => call.method).sort()).toEqual(["answerCallbackQuery", "sendMessage"]);
    const sent = apiCalls.find((call) => call.method === "sendMessage")!.payload;
    expect(sent.chat_id).toBe(42);
    expect(sent.text).toMatch(hint);
    // The greeting keeps its buttons, so another can be tapped.
    expect(apiCalls.map((call) => call.method)).not.toContain("editMessageText");
  });
  const OPTIONS_BUTTONS = [
    ["Add Note", "hint:note"],
    ["Add Task", "hint:task"],
    ["Show Tasks", "list:tasks"],
    ["Show Notes", "list:notes"],
    ["Research", "hint:research"],
    ["Something else", "hint:other"],
  ];

  it.each(["options", " Options ", "/options"])("shows every option as a button when the User types %j, without the core", async (text) => {
    apiCalls.length = 0;
    received.length = 0;
    const entities = text.startsWith("/") ? [{ type: "bot_command", offset: 0, length: text.length }] : undefined;
    await post({ message: { message_id: 57, date: 1_793_000_000, chat, from, text, entities } });

    expect(received).toEqual([]);
    expect(apiCalls.map((call) => call.method)).toEqual(["sendMessage"]);
    expect(apiCalls[0]!.payload.text).toBe("What would you like to do?");
    expect(buttonsOf(apiCalls[0]!.payload)).toEqual(OPTIONS_BUTTONS);
  });

  it.each(["tasks", "notes"] as const)("asks the core to list the User's %s when Show is tapped, in a new message", async (what) => {
    apiCalls.length = 0;
    received.length = 0;
    nextHandling();
    await post({
      callback_query: {
        id: `cb-list-${what}`,
        chat_instance: "ci",
        from,
        message: { message_id: 900, date: 1_793_000_000, chat, text: "What would you like to do?" },
        data: `list:${what}`,
      },
    });
    await handlingDone;

    expect(received).toEqual([
      expect.objectContaining({ sender: { channel: "telegram", channelId: "42" }, content: { kind: "list", what } }),
    ]);
    expect(apiCalls.map((call) => call.method).sort()).toEqual(["answerCallbackQuery", "sendMessage"]);
  });
});
