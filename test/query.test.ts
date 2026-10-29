import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import type { FastifyInstance } from "fastify";
import { createCore, type CoreEvent, type HandledMessage } from "../src/core/core.ts";
import { createInventoryClient } from "../src/inventory/client.ts";
import type { Item } from "../src/inventory/items.ts";
import { createOpenRouter } from "../src/llm/openrouter.ts";
import { buildServer } from "../src/server.ts";
import { ensureFirstAdmin } from "../src/users.ts";
import { toolCall, useFakeOpenRouter } from "./fakes/fake-openrouter.ts";
import { useMemoryMongo } from "./fakes/memory-mongo.ts";

const MODEL = "test/model-a";
const BACKUP = "test/model-b";
const API_KEY = "inv-key";

const ITEMS: Item[] = [
  { sku: "SKU-01", name: "Blue mug", category: "Kitchen", quantity: 40, unitPrice: 6.5, location: "Warehouse A" },
  { sku: "SKU-02", name: "Red mug", category: "Kitchen", quantity: 4, unitPrice: 6.5, location: "Warehouse B" },
  { sku: "SKU-03", name: "Desk lamp", category: "Office", quantity: 3, unitPrice: 24, location: "Warehouse B" },
];

describe("core: a Query about the Inventory", () => {
  const database = useMemoryMongo();
  const openRouter = useFakeOpenRouter();
  let inventoryServer: FastifyInstance;
  let inventoryBaseUrl: string;

  beforeAll(async () => {
    inventoryServer = buildServer({ logger: false, inventory: { items: ITEMS, apiKey: API_KEY } });
    await inventoryServer.listen({ port: 0, host: "127.0.0.1" });
    inventoryBaseUrl = `http://127.0.0.1:${(inventoryServer.server.address() as AddressInfo).port}/inventory`;
  });
  afterAll(() => inventoryServer.close());

  async function send(
    text: string,
    inventory: { apiKey?: string; baseUrl?: string } = {},
  ): Promise<{ events: CoreEvent[]; handled: HandledMessage }> {
    await ensureFirstAdmin(database(), { username: "owner", password: "pw", telegramId: "42", timezone: "UTC" });
    const core = createCore({
      database: database(),
      llm: createOpenRouter({ apiKey: "key", baseUrl: openRouter.baseUrl, models: [MODEL, BACKUP] }),
      inventory: createInventoryClient({ baseUrl: inventoryBaseUrl, apiKey: API_KEY, ...inventory }),
      defaultTimezone: "UTC",
    });
    const events: CoreEvent[] = [];
    const handled = await core.handleMessage(
      {
        sender: { channel: "telegram", channelId: "42" },
        chatId: "chat-42",
        messageId: "1001",
        content: { kind: "text", text },
      },
      async (event) => {
        events.push(event);
      },
    );
    return { events, handled };
  }

  /** The tool results the core sent back to the model, in order; the last request carries the whole conversation. */
  const toolResultsSent = () =>
    openRouter.requests.at(-1)!.body.messages.filter((message: { role: string }) => message.role === "tool");

  it("looks items up over HTTP and replies with the model's plain-language answer", async () => {
    openRouter.script(MODEL, toolCall("search_items", { name: "blue mug" }));
    openRouter.script(MODEL, toolCall("answer_query", { answer: "You have 40 blue mugs, in Warehouse A." }));

    const { events, handled } = await send("How many blue mugs do we have?");

    expect(events).toEqual([
      { type: "processing-started" },
      { type: "result", result: { kind: "query-answered", answer: "You have 40 blue mugs, in Warehouse A." } },
    ]);
    const [result] = toolResultsSent();
    expect(result.tool_call_id).toBe("call_1");
    expect(JSON.parse(result.content)).toEqual({ items: [ITEMS[0]] });
    expect(handled.inventoryRequests).toEqual([
      { tool: "search_items", endpoint: "/inventory/items?name=blue+mug", status: 200, latencyMs: expect.any(Number) },
    ]);
  });

  it("tells the model plainly when nothing matched, and replies with its answer", async () => {
    openRouter.script(MODEL, toolCall("search_items", { name: "teapot", low_stock: true }));
    openRouter.script(MODEL, toolCall("answer_query", { answer: "Nothing matched: there are no teapots running low." }));

    const { events, handled } = await send("Are we low on teapots?");

    expect(toolResultsSent().map((message: { content: string }) => message.content)).toEqual(["No items matched."]);
    expect(events.at(-1)).toEqual({
      type: "result",
      result: { kind: "query-answered", answer: "Nothing matched: there are no teapots running low." },
    });
    expect(handled.inventoryRequests[0]).toMatchObject({ endpoint: "/inventory/items?name=teapot&lowStock=true" });
  });

  it("treats a SKU that does not exist as nothing matched", async () => {
    openRouter.script(MODEL, toolCall("get_item", { sku: "SKU-99" }));
    openRouter.script(MODEL, toolCall("answer_query", { answer: "There's no item with SKU-99." }));

    const { handled } = await send("What is SKU-99?");

    expect(toolResultsSent().map((message: { content: string }) => message.content)).toEqual(["No items matched."]);
    expect(handled.inventoryRequests).toEqual([
      { tool: "get_item", endpoint: "/inventory/items/SKU-99", status: 404, latencyMs: expect.any(Number) },
    ]);
  });

  it("lets the model look up more than once before answering", async () => {
    openRouter.script(MODEL, toolCall("search_items", { location: "Warehouse B", low_stock: true }));
    openRouter.script(MODEL, toolCall("get_item", { sku: "SKU-03" }));
    openRouter.script(MODEL, toolCall("answer_query", { answer: "Red mugs (4) and desk lamps (3) are low in Warehouse B." }));

    const { events, handled } = await send("What's running low in Warehouse B?");

    expect(JSON.parse(toolResultsSent()[1].content)).toEqual(ITEMS[2]);
    expect(handled.inventoryRequests.map((request) => request.endpoint)).toEqual([
      "/inventory/items?location=Warehouse+B&lowStock=true",
      "/inventory/items/SKU-03",
    ]);
    expect(events.at(-1)).toMatchObject({ result: { kind: "query-answered" } });
  });

  it("declines a Command politely and makes no Inventory request", async () => {
    openRouter.script(MODEL, toolCall("change_inventory", {}));

    const { events, handled } = await send("Add 50 units of SKU-12");

    expect(events).toEqual([{ type: "processing-started" }, { type: "result", result: { kind: "command-declined" } }]);
    expect(handled.inventoryRequests).toEqual([]);
  });

  it("produces an error result when the Inventory API refuses the request", async () => {
    openRouter.script(MODEL, toolCall("search_items", { name: "mug" }));

    const { events, handled } = await send("How many mugs?", { apiKey: "wrong-key" });

    expect(events.at(-1)).toEqual({ type: "result", result: { kind: "error" } });
    expect(handled.inventoryRequests).toMatchObject([{ tool: "search_items", status: 401 }]);
  });

  it("moves to the next model when a lookup is unusable", async () => {
    openRouter.script(MODEL, toolCall("get_item", {}));
    openRouter.script(BACKUP, toolCall("get_item", { sku: "SKU-01" }));
    openRouter.script(MODEL, toolCall("answer_query", { answer: "SKU-01 is the blue mug; 40 in stock." }));

    const { events, handled } = await send("What is SKU-01?");

    expect(events.at(-1)).toMatchObject({ result: { kind: "query-answered" } });
    expect(handled.modelAttempts).toEqual([
      { model: MODEL, outcome: "failed", reason: expect.stringContaining("sku") },
      { model: BACKUP, outcome: "succeeded" },
      { model: MODEL, outcome: "succeeded" },
    ]);
  });

  it("stores no Inventory data, Note or Task in MongoDB", async () => {
    openRouter.script(MODEL, toolCall("search_items", {}));
    openRouter.script(MODEL, toolCall("answer_query", { answer: "You have 3 kinds of item." }));

    await send("What do we have?");

    const collections = (await database().db.listCollections().toArray()).map((collection) => collection.name);
    expect(collections.filter((name) => !["notes", "tasks", "users"].includes(name))).toEqual([]);
    expect(await database().notes.countDocuments()).toBe(0);
    expect(await database().tasks.countDocuments()).toBe(0);
  });

  it("makes the model answer once it has made four lookups", async () => {
    for (let i = 0; i < 4; i++) openRouter.script(MODEL, toolCall("search_items", { name: "mug" }));
    openRouter.script(MODEL, toolCall("search_items", { name: "mug" }));
    openRouter.script(BACKUP, toolCall("answer_query", { answer: "You have 44 mugs." }));

    const { events, handled } = await send("How many mugs, really?");

    expect(handled.inventoryRequests).toHaveLength(4);
    const lastTools = openRouter.requests.at(-1)!.body.tools.map((tool: { function: { name: string } }) => tool.function.name);
    expect(lastTools).toEqual(["answer_query"]);
    expect(events.at(-1)).toEqual({ type: "result", result: { kind: "query-answered", answer: "You have 44 mugs." } });
  });

  it("still records the request when the Inventory API cannot be reached", async () => {
    openRouter.script(MODEL, toolCall("get_item", { sku: "SKU-01" }));

    const { events, handled } = await send("What is SKU-01?", { baseUrl: "http://127.0.0.1:1/inventory" });

    expect(events.at(-1)).toEqual({ type: "result", result: { kind: "error" } });
    expect(handled.inventoryRequests).toMatchObject([
      { tool: "get_item", endpoint: "/inventory/items/SKU-01", status: 0, error: expect.any(String) },
    ]);
  });
});
