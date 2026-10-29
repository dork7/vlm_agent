import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { Core, HandledMessage, InboundMessage } from "../src/core/core.ts";
import { buildServer } from "../src/server.ts";
import { createTelegramBot, telegramWebhookHandler } from "../src/telegram/adapter.ts";

const SECRET = "webhook-secret";
const PATH = "/telegram/webhook";

describe("Telegram webhook route", () => {
  let server: FastifyInstance;
  const received: InboundMessage[] = [];
  let finishHandling: (() => void) | undefined;

  beforeAll(async () => {
    // A core that is still working when the route answers: the update must be acknowledged before handling ends.
    const core: Core = {
      handleMessage(message) {
        received.push(message);
        return new Promise<HandledMessage>((resolve) => {
          finishHandling = () =>
            resolve({ duplicate: false, transcription: null, modelAttempts: [], inventoryRequests: [] });
        });
      },
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
    // No real Telegram: every Bot API call is answered locally.
    bot.api.config.use(async () => ({ ok: true, result: true }) as never);

    server = buildServer({
      logger: false,
      inventory: { items: [], apiKey: "unused" },
      webhook: { path: PATH, handler: telegramWebhookHandler(bot, SECRET) },
    });
    await server.ready();
  });
  afterAll(async () => {
    finishHandling?.();
    await server.close();
  });

  const update = {
    update_id: 9001,
    message: {
      message_id: 55,
      date: 1_793_000_000,
      chat: { id: 42, type: "private", first_name: "Owner" },
      from: { id: 42, is_bot: false, first_name: "Owner" },
      text: "Remember the dentist's new number",
    },
  };

  it("acknowledges an update straight away and hands it to the Telegram adapter", async () => {
    const response = await server.inject({
      method: "POST",
      url: PATH,
      headers: { "x-telegram-bot-api-secret-token": SECRET },
      payload: update,
    });

    expect(response.statusCode).toBe(200);
    expect(received).toEqual([
      {
        sender: { channel: "telegram", channelId: "42" },
        chatId: "42",
        messageId: "55",
        content: { kind: "text", text: "Remember the dentist's new number" },
      },
    ]);
  });

  it("rejects an update without Telegram's secret", async () => {
    const response = await server.inject({
      method: "POST",
      url: PATH,
      headers: { "x-telegram-bot-api-secret-token": "guess" },
      payload: { ...update, update_id: 9002 },
    });

    expect(response.statusCode).toBe(401);
    expect(received).toHaveLength(1);
  });
});
