import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import type { FastifyInstance } from "fastify";
import { createCore, type InboundMessage } from "../src/core/core.ts";
import { createInventoryClient } from "../src/inventory/client.ts";
import type { Item } from "../src/inventory/items.ts";
import { createOpenRouter } from "../src/llm/openrouter.ts";
import { buildServer } from "../src/server.ts";
import type { Transcriber } from "../src/transcriber/transcriber.ts";
import { ensureFirstAdmin } from "../src/users.ts";
import { toolCall, useFakeOpenRouter } from "./fakes/fake-openrouter.ts";
import { useMemoryMongo } from "./fakes/memory-mongo.ts";
import { unusedTranscriber } from "./fakes/unused.ts";

const FIRST = "test/first";
const SECOND = "test/second";
const API_KEY = "inv-key";
const ITEMS: Item[] = [
  { sku: "SKU-01", name: "Blue mug", category: "Kitchen", quantity: 40, unitPrice: 6.5, location: "Warehouse A" },
];

describe("core: every inbound message is recorded as one Run", () => {
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
    content: InboundMessage["content"],
    options: { senderId?: string; messageId?: string; transcriber?: Transcriber; clarifyWith?: "buttons" | "text" } = {},
  ) {
    await ensureFirstAdmin(database(), { username: "owner", password: "pw", telegramId: "42", timezone: "UTC" });
    const core = createCore({
      database: database(),
      llm: createOpenRouter({ apiKey: "key", baseUrl: openRouter.baseUrl, models: [FIRST, SECOND] }),
      inventory: createInventoryClient({ baseUrl: inventoryBaseUrl, apiKey: API_KEY }),
      transcriber: options.transcriber ?? unusedTranscriber,
      defaultTimezone: "UTC",
    });
    const senderId = options.senderId ?? "42";
    return core.handleMessage(
      {
        sender: { channel: "telegram", channelId: senderId },
        chatId: `chat-${senderId}`,
        messageId: options.messageId ?? "1001",
        content,
        clarifyWith: options.clarifyWith ?? "buttons",
      },
      async () => {},
    );
  }

  const stageNames = (run: { stages: Array<{ name: string }> }) => run.stages.map((stage) => stage.name);

  it("records a typed Note as one succeeded Run with its stages in order", async () => {
    openRouter.script(FIRST, toolCall("save_note", { heading: "Dentist's new number" }));

    await send({ kind: "text", text: "Remember the dentist's new number" });

    const runs = await database().runs.find().toArray();
    expect(runs).toHaveLength(1);
    const [run] = runs;
    expect(run).toMatchObject({
      sender: { channel: "telegram", channelId: "42" },
      username: "owner",
      status: "succeeded",
      type: "note",
      error: null,
    });
    expect(run!.durationMs).toEqual(expect.any(Number));
    expect(stageNames(run!)).toEqual(["received", "classification", "reply"]);
    for (const stage of run!.stages) {
      expect(stage).toMatchObject({ startedAt: expect.any(Date), durationMs: expect.any(Number), outcome: "succeeded" });
    }
  });

  it("records a Task as a succeeded Run of type task", async () => {
    openRouter.script(FIRST, toolCall("save_task", { heading: "Book the car service", description: "Call the garage" }));

    await send({ kind: "text", text: "I need to book the car service" });

    const [run] = await database().runs.find().toArray();
    expect(run).toMatchObject({ status: "succeeded", type: "task", error: null });
    expect(stageNames(run!)).toEqual(["received", "classification", "reply"]);
  });

  it("records a Query with each tool call's tool, endpoint, HTTP status and latency", async () => {
    openRouter.script(FIRST, toolCall("search_items", { name: "mug" }));
    openRouter.script(FIRST, toolCall("get_item", { sku: "SKU-99" }));
    openRouter.script(FIRST, toolCall("answer_query", { answer: "You have 40 blue mugs." }));

    await send({ kind: "text", text: "How many mugs do we have?" });

    const [run] = await database().runs.find().toArray();
    expect(run).toMatchObject({ status: "succeeded", type: "query", error: null });
    expect(stageNames(run!)).toEqual([
      "received",
      "classification",
      "tool-call",
      "query-answer",
      "tool-call",
      "query-answer",
      "reply",
    ]);
    const toolCalls = run!.stages.filter((stage) => stage.name === "tool-call");
    expect(toolCalls).toMatchObject([
      {
        outcome: "succeeded",
        details: { tool: "search_items", endpoint: "/inventory/items?name=mug", status: 200, latencyMs: expect.any(Number) },
      },
      {
        outcome: "succeeded",
        details: { tool: "get_item", endpoint: "/inventory/items/SKU-99", status: 404, latencyMs: expect.any(Number) },
      },
    ]);
  });

  it("records an awaiting-clarification Run, which succeeds once the Clarification is answered", async () => {
    openRouter.script(FIRST, toolCall("ask_clarification", {}));
    const asked = await send({ kind: "text", text: "the supplier thing" });

    const [waiting] = await database().runs.find().toArray();
    expect(waiting).toMatchObject({ status: "awaiting-clarification", type: null, error: null });
    expect(waiting!.clarificationId?.toHexString()).toBe(asked.clarification!.id);

    openRouter.script(FIRST, toolCall("save_note", { heading: "The supplier thing" }));
    await send(
      { kind: "clarification-answer", clarificationId: asked.clarification!.id, answer: "note" },
      { messageId: "1002" },
    );

    const runs = await database().runs.find().sort({ startedAt: 1, _id: 1 }).toArray();
    expect(runs).toHaveLength(2);
    expect(runs[0]).toMatchObject({ _id: waiting!._id, status: "succeeded", type: "note" });
    expect(runs[1]).toMatchObject({ content: "clarification-answer", status: "succeeded", type: "note" });
    expect(runs[1]!.clarificationId?.toHexString()).toBe(asked.clarification!.id);
  });

  it("records a refused sender as a refused Run with no User", async () => {
    await send({ kind: "text", text: "hello?" }, { senderId: "666" });

    const [run] = await database().runs.find().toArray();
    expect(run).toMatchObject({
      sender: { channel: "telegram", channelId: "666" },
      userId: null,
      status: "refused",
      type: null,
      error: null,
    });
    expect(stageNames(run!)).toEqual(["received", "reply"]);
  });

  it("records every model attempt, including those that failed before a fallback answered", async () => {
    openRouter.script(FIRST, { status: 429, body: { error: { message: "rate limited" } } });
    openRouter.script(SECOND, toolCall("save_note", { heading: "Dentist's new number" }));

    await send({ kind: "text", text: "Remember the dentist's new number" });

    const [run] = await database().runs.find().toArray();
    expect(run).toMatchObject({ status: "succeeded", type: "note" });
    const classification = run!.stages.find((stage) => stage.name === "classification");
    expect(classification).toMatchObject({
      outcome: "succeeded",
      details: {
        attempts: [
          { model: FIRST, outcome: "failed", reason: expect.stringContaining("429") },
          { model: SECOND, outcome: "succeeded" },
        ],
      },
    });
  });

  it("records a failed Run, with the error and its stage, when every model fails", async () => {
    openRouter.script(FIRST, { status: 503, body: { error: { message: "overloaded" } } });
    openRouter.script(SECOND, { status: 500, body: { error: { message: "boom" } } });

    await send({ kind: "text", text: "Remember the dentist's new number" });

    const [run] = await database().runs.find().toArray();
    expect(run).toMatchObject({
      status: "failed",
      type: null,
      error: { stage: "classification", message: expect.stringContaining("Every model failed") },
    });
    expect(stageNames(run!)).toEqual(["received", "classification", "reply"]);
    expect(run!.stages[1]).toMatchObject({
      outcome: "failed",
      details: { attempts: [{ model: FIRST, outcome: "failed" }, { model: SECOND, outcome: "failed" }] },
    });
  });

  it("records tokens and cost on each model attempt where OpenRouter reports them", async () => {
    const withUsage = (response: { status: number; body: any }, usage: Record<string, number>) => ({
      ...response,
      body: { ...response.body, usage },
    });
    openRouter.script(
      FIRST,
      withUsage(toolCall("save_note", { heading: " " }), { prompt_tokens: 120, completion_tokens: 9, total_tokens: 129 }),
    );
    openRouter.script(
      SECOND,
      withUsage(toolCall("save_note", { heading: "Dentist's new number" }), {
        prompt_tokens: 118,
        completion_tokens: 12,
        total_tokens: 130,
        cost: 0.00042,
      }),
    );

    await send({ kind: "text", text: "Remember the dentist's new number" });

    const [run] = await database().runs.find().toArray();
    expect(run!.stages.find((stage) => stage.name === "classification")!.details.attempts).toEqual([
      {
        model: FIRST,
        outcome: "failed",
        reason: expect.stringContaining("heading"),
        tokens: { prompt: 120, completion: 9, total: 129 },
      },
      { model: SECOND, outcome: "succeeded", tokens: { prompt: 118, completion: 12, total: 130 }, cost: 0.00042 },
    ]);
  });

  /** A Transcriber that times its steps as the real one does, failing at `failAt` if given. */
  function stagedTranscriber(failAt?: "download" | "conversion" | "transcription"): Transcriber {
    return {
      model: "fake-whisper",
      async transcribe(audio, timeStage = (_stage, step) => step()) {
        const step = (stage: "download" | "conversion" | "transcription") => async () => {
          if (stage === failAt) throw new Error(`${stage} broke`);
        };
        await timeStage("download", async () => {
          await audio.download("/unused");
          await step("download")();
        });
        await timeStage("conversion", step("conversion"));
        return timeStage("transcription", async () => {
          await step("transcription")();
          return "Remember to water the plants";
        });
      },
    };
  }
  const voice: InboundMessage["content"] = { kind: "voice", durationSeconds: 7, download: async () => {} };

  it("records a Voice Message's download, conversion and transcription as stages", async () => {
    openRouter.script(FIRST, toolCall("save_note", { heading: "Water the plants" }));

    await send(voice, { transcriber: stagedTranscriber() });

    const [run] = await database().runs.find().toArray();
    expect(run).toMatchObject({ content: "voice", status: "succeeded", type: "note" });
    expect(stageNames(run!)).toEqual(["received", "download", "conversion", "transcription", "classification", "reply"]);
    expect(run!.stages[3]).toMatchObject({
      outcome: "succeeded",
      details: { model: "fake-whisper", transcriptLength: "Remember to water the plants".length },
    });
  });

  it("records a failed transcription with the stage it failed in", async () => {
    await send(voice, { transcriber: stagedTranscriber("conversion") });

    const [run] = await database().runs.find().toArray();
    expect(run).toMatchObject({ status: "failed", error: { stage: "conversion", message: "conversion broke" } });
    expect(stageNames(run!)).toEqual(["received", "download", "conversion", "reply"]);
    expect(run!.stages[2]).toMatchObject({ outcome: "failed", error: "conversion broke" });
  });

  it("records no second Run for a duplicate delivery", async () => {
    openRouter.script(FIRST, toolCall("save_note", { heading: "Dentist's new number" }));

    await send({ kind: "text", text: "Remember the dentist's new number" });
    await send({ kind: "text", text: "Remember the dentist's new number" });

    expect(await database().runs.countDocuments()).toBe(1);
  });
});
