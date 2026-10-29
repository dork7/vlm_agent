import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { Core, CoreEvent, HandledMessage, InboundMessage } from "../src/core/core.ts";
import { buildServer } from "../src/server.ts";
import { createTelegramBot, telegramWebhookHandler } from "../src/telegram/adapter.ts";

const SECRET = "webhook-secret";
const PATH = "/telegram/webhook";
const CLARIFICATION_ID = "6720a1b2c3d4e5f6a7b8c9d0";

const BOT_INFO = {
  id: 123,
  is_bot: true as const,
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
};

describe("Telegram adapter: a Clarification", () => {
  let server: FastifyInstance;
  let received: InboundMessage[];
  let apiCalls: Array<{ method: string; payload: any }>;
  /** What the stub core emits for each message. */
  let script: CoreEvent[];
  let handlingDone: Promise<void>;
  let finishHandling: () => void;

  beforeAll(async () => {
    const core: Core = {
      async handleMessage(message, emit) {
        received.push(message);
        for (const event of script) await emit(event);
        finishHandling();
        return { duplicate: false, transcription: null, modelAttempts: [], inventoryRequests: [], clarification: null } satisfies HandledMessage;
      },
      sendDueReminders: async () => {},
      completeTask: async () => ({ kind: "task-not-found" }),
    };
    const bot = createTelegramBot("123:test-token", core, { botInfo: BOT_INFO });
    // No real Telegram: Bot API calls are recorded and answered locally.
    bot.api.config.use(async (_prev, method, payload) => {
      apiCalls.push({ method, payload });
      const result = method === "sendMessage" ? { message_id: 900, date: 0, chat: { id: 42, type: "private" } } : true;
      return { ok: true, result } as never;
    });
    server = buildServer({
      logger: false,
      inventory: { items: [], apiKey: "unused" },
      webhook: { path: PATH, handler: telegramWebhookHandler(bot, SECRET) },
    });
    await server.ready();
  });
  afterAll(() => server.close());

  beforeEach(() => {
    received = [];
    apiCalls = [];
    handlingDone = new Promise((resolve) => {
      finishHandling = resolve;
    });
  });

  const post = (update: object) =>
    server.inject({ method: "POST", url: PATH, headers: { "x-telegram-bot-api-secret-token": SECRET }, payload: update });

  it("is shown as Note / Task / Query buttons on the processing reply", async () => {
    script = [
      { type: "processing-started" },
      { type: "clarification-needed", clarificationId: CLARIFICATION_ID, options: ["note", "task", "query"] },
    ];

    await post({
      update_id: 1,
      message: {
        message_id: 55,
        date: 1_793_000_000,
        chat: { id: 42, type: "private", first_name: "Owner" },
        from: { id: 42, is_bot: false, first_name: "Owner" },
        text: "the supplier thing on Thursday",
      },
    });
    await handlingDone;

    expect(received[0]).toMatchObject({ messageId: "55", clarifyWith: "buttons" });
    expect(apiCalls.map((call) => call.method)).toEqual(["sendMessage", "editMessageText"]);
    expect(apiCalls[1]!.payload).toMatchObject({
      chat_id: 42,
      message_id: 900,
      text: expect.stringContaining("Note, a Task or a Query"),
      reply_markup: {
        inline_keyboard: [
          [
            { text: "Note", callback_data: `clarify:${CLARIFICATION_ID}:note` },
            { text: "Task", callback_data: `clarify:${CLARIFICATION_ID}:task` },
            { text: "Query", callback_data: `clarify:${CLARIFICATION_ID}:query` },
          ],
        ],
      },
    });
  });

  it("answers the Clarification when a button is tapped, editing the question into the result", async () => {
    script = [
      { type: "processing-started" },
      { type: "result", result: { kind: "task-saved", heading: "Call the supplier", due: null } },
    ];

    await post({
      update_id: 2,
      callback_query: {
        id: "cb-777",
        chat_instance: "ci",
        from: { id: 42, is_bot: false, first_name: "Owner" },
        message: { message_id: 900, date: 1_793_000_000, chat: { id: 42, type: "private", first_name: "Owner" }, text: "?" },
        data: `clarify:${CLARIFICATION_ID}:task`,
      },
    });
    await handlingDone;

    expect(received).toEqual([
      {
        sender: { channel: "telegram", channelId: "42" },
        chatId: "42",
        messageId: "callback:cb-777",
        content: { kind: "clarification-answer", clarificationId: CLARIFICATION_ID, answer: "task" },
        clarifyWith: "buttons",
      },
    ]);
    expect(apiCalls.map((call) => [call.method, call.payload.message_id, call.payload.text])).toEqual([
      ["answerCallbackQuery", undefined, undefined],
      ["editMessageText", 900, "processing…"],
      ["editMessageText", 900, "Saved Task: Call the supplier"],
    ]);
  });
});
