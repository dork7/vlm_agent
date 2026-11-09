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

describe("Telegram adapter: a Research answer", () => {
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
        return { duplicate: false, transcription: null, modelAttempts: [], inventoryRequests: [], clarification: null, runId: null } satisfies HandledMessage;
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

  /** Sends a typed message and returns the text the processing reply was finally edited into. */
  async function replyTo(result: CoreEvent): Promise<string> {
    script = [{ type: "processing-started" }, result];
    await post({
      update_id: 1,
      message: {
        message_id: 55,
        date: 1_793_000_000,
        chat: { id: 42, type: "private", first_name: "Owner" },
        from: { id: 42, is_bot: false, first_name: "Owner" },
        text: "find out about shipping",
      },
    });
    await handlingDone;
    return apiCalls.filter((call) => call.method === "editMessageText").at(-1)!.payload.text;
  }

  const page = (index: number, padding = 0) => ({ url: `https://news.example/${index}${"x".repeat(padding)}`, title: `Page ${index}` });
  const line = (source: { url: string; title: string }) => `• ${source.title}: ${source.url}`;

  it("shows the answer, then its web pages and the User's own items as sources", async () => {
    const text = await replyTo({
      type: "result",
      result: {
        kind: "researched",
        answer: "Ports are busy this week.",
        sources: { web: [page(1)], items: [{ kind: "note", heading: "Supplier contact" }] },
      },
    });

    expect(text).toBe(`Ports are busy this week.\n\nSources:\n${line(page(1))}\n• Your Note: Supplier contact`);
  });

  it("cuts a long answer to fit one Telegram message, keeping every source whole", async () => {
    const sources = [page(1), page(2), page(3)];
    const text = await replyTo({
      type: "result",
      result: { kind: "researched", answer: "A".repeat(5000), sources: { web: sources, items: [] } },
    });

    expect(text.length).toBeLessThanOrEqual(4096);
    expect(text).toMatch(/^A+…\n\nSources:\n/);
    expect(text.endsWith(sources.map(line).join("\n"))).toBe(true);
  });

  it("leaves out whole sources that don't fit, never cutting a link short", async () => {
    const sources = [1, 2, 3, 4, 5].map((index) => page(index, 900));
    const text = await replyTo({
      type: "result",
      result: { kind: "researched", answer: "Short answer.", sources: { web: sources, items: [] } },
    });

    expect(text.length).toBeLessThanOrEqual(4096);
    const listed = text.split("\n").filter((row) => row.startsWith("•"));
    expect(listed.length).toBeGreaterThan(0);
    expect(listed.length).toBeLessThan(sources.length);
    expect(listed).toEqual(sources.slice(0, listed.length).map(line));
  });

  it("says plainly when nothing was found", async () => {
    expect(await replyTo({ type: "result", result: { kind: "nothing-found" } })).toBe(
      "I couldn't find anything about that in your Notes or Tasks.",
    );
  });
});
