import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { Bot } from "grammy";
import type { CompleteTaskResult, Core } from "../src/core/core.ts";
import type { ChannelIdentity } from "../src/db.ts";
import { buildServer } from "../src/server.ts";
import { createTelegramBot, sendTelegramReminder, telegramWebhookHandler } from "../src/telegram/adapter.ts";

const SECRET = "webhook-secret";
const PATH = "/telegram/webhook";
const TASK_ID = "6720a1b2c3d4e5f6a7b8c9d0";

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

describe("Telegram adapter: a Reminder", () => {
  let server: FastifyInstance;
  let bot: Bot;
  let apiCalls: Array<{ method: string; payload: any }>;
  let completed: Array<{ sender: ChannelIdentity; taskId: string }>;
  /** What the stub core answers when a Task is marked done. */
  let completion: CompleteTaskResult;
  let handlingDone: Promise<void>;
  let finishHandling: () => void;

  beforeAll(async () => {
    const core: Core = {
      handleMessage: async () => {
        throw new Error("This test did not expect a message");
      },
      sendDueReminders: async () => {},
      async completeTask(sender, taskId) {
        completed.push({ sender, taskId });
        return completion;
      },
    };
    bot = createTelegramBot("123:test-token", core, { botInfo: BOT_INFO });
    // No real Telegram: Bot API calls are recorded and answered locally.
    bot.api.config.use(async (_prev, method, payload) => {
      apiCalls.push({ method, payload });
      if (method === "editMessageText") finishHandling();
      const result = method === "sendMessage" ? { message_id: 901, date: 0, chat: { id: 42, type: "private" } } : true;
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
    apiCalls = [];
    completed = [];
    handlingDone = new Promise((resolve) => {
      finishHandling = resolve;
    });
  });

  const tapDone = (taskId = TASK_ID) =>
    server.inject({
      method: "POST",
      url: PATH,
      headers: { "x-telegram-bot-api-secret-token": SECRET },
      payload: {
        update_id: 10,
        callback_query: {
          id: "cb-1",
          chat_instance: "ci",
          from: { id: 42, is_bot: false, first_name: "Owner" },
          message: { message_id: 901, date: 1_793_000_000, chat: { id: 42, type: "private", first_name: "Owner" }, text: "Reminder" },
          data: `done:${taskId}`,
        },
      },
    });

  it("is sent to the Channel Identity's chat with the Task's Heading, due time and a Done button", async () => {
    await sendTelegramReminder(bot, {
      type: "reminder",
      to: { channel: "telegram", channelId: "42" },
      taskId: TASK_ID,
      heading: "Call the supplier",
      due: { date: "2026-10-29", time: "15:00" },
    });

    expect(apiCalls).toEqual([
      {
        method: "sendMessage",
        payload: {
          chat_id: "42",
          text: "Reminder: Call the supplier (due Thu 29 Oct 2026, 15:00)",
          reply_markup: { inline_keyboard: [[{ text: "Done", callback_data: `done:${TASK_ID}` }]] },
        },
      },
    ]);
  });

  it("marks the Task done when Done is tapped, editing the Reminder to say so", async () => {
    completion = { kind: "task-done", heading: "Call the supplier" };

    await tapDone();
    await handlingDone;

    expect(completed).toEqual([{ sender: { channel: "telegram", channelId: "42" }, taskId: TASK_ID }]);
    expect(apiCalls.map((call) => [call.method, call.payload.message_id, call.payload.text])).toEqual([
      ["answerCallbackQuery", undefined, undefined],
      ["editMessageText", 901, "Done: Call the supplier"],
    ]);
  });

  it("says so when the Task is no longer there", async () => {
    completion = { kind: "task-not-found" };

    await tapDone();
    await handlingDone;

    expect(apiCalls.at(-1)).toMatchObject({
      method: "editMessageText",
      payload: { message_id: 901, text: "Sorry, I couldn't find that Task. It may have been deleted." },
    });
  });
});
