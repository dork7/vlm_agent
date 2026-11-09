import { ObjectId } from "mongodb";
import { describe, expect, it } from "vitest";
import { createCore, type CoreEvent, type HandledMessage } from "../src/core/core.ts";
import { createOpenRouter } from "../src/llm/openrouter.ts";
import { ensureFirstAdmin } from "../src/users.ts";
import { textAnswer, toolCall, useFakeOpenRouter } from "./fakes/fake-openrouter.ts";
import { useMemoryMongo } from "./fakes/memory-mongo.ts";
import { unusedInventory, unusedTranscriber } from "./fakes/unused.ts";

const MODEL = "test/model-a";
const BACKUP = "test/model-b";
const LOCAL_MODEL = "local-llama";

const VAT_PAGE = { url: "https://tax.example/vat-exports", title: "VAT on exports" };

describe("core: Research", () => {
  const database = useMemoryMongo();
  const openRouter = useFakeOpenRouter();

  /** With `local`, the fake also serves as the local model server, listing LOCAL_MODEL. */
  async function send(text: string, local = false): Promise<{ events: CoreEvent[]; handled: HandledMessage }> {
    await ensureFirstAdmin(database(), { username: "owner", password: "pw", telegramId: "42", timezone: "UTC" });
    if (local) openRouter.models = [LOCAL_MODEL];
    const core = createCore({
      database: database(),
      llm: createOpenRouter({
        apiKey: "key",
        baseUrl: openRouter.baseUrl,
        models: [MODEL, BACKUP],
        ...(local ? { local: { baseUrl: openRouter.baseUrl } } : {}),
      }),
      transcriber: unusedTranscriber,
      inventory: unusedInventory,
      defaultTimezone: "UTC",
    });
    const events: CoreEvent[] = [];
    const handled = await core.handleMessage(
      {
        sender: { channel: "telegram", channelId: "42" },
        chatId: "chat-42",
        messageId: String(Math.random()),
        content: { kind: "text", text },
        clarifyWith: "buttons",
      },
      async (event) => {
        events.push(event);
      },
    );
    return { events, handled };
  }

  it("searches the web and replies with the answer and the pages it cited", async () => {
    openRouter.script(MODEL, toolCall("research", { question: "VAT rate on exports in the UAE", web: true }));
    openRouter.script(MODEL, textAnswer("Exports from the UAE are zero-rated: 0% VAT.", [VAT_PAGE]));

    const { events } = await send("find out the VAT rate on exports");

    expect(events).toEqual([
      { type: "processing-started" },
      {
        type: "result",
        result: {
          kind: "researched",
          answer: "Exports from the UAE are zero-rated: 0% VAT.",
          sources: { web: [VAT_PAGE], items: [] },
        },
      },
    ]);
    const research = openRouter.requests.at(-1)!;
    expect(research.body.plugins).toEqual([{ id: "web", max_results: 5 }]);
    expect(JSON.stringify(research.body.messages)).toContain("VAT rate on exports in the UAE");
    expect(await database().notes.countDocuments()).toBe(0);
    expect(await database().tasks.countDocuments()).toBe(0);
  });

  /** Saves a Note and a Task for the owner, and a Note for someone else, all about the supplier. */
  async function saveItems() {
    await ensureFirstAdmin(database(), { username: "owner", password: "pw", telegramId: "42", timezone: "UTC" });
    const owner = (await database().users.findOne({ username: "owner" }))!._id!;
    const source = { channel: "telegram", chatId: "chat-42", messageId: "1" };
    const at = new Date("2026-11-01T09:00:00Z");
    await database().notes.insertMany([
      { ownerId: owner, heading: "Supplier contact", text: "Ahmed at Gulf Packaging, ext 214.", transcript: "", source, createdAt: at, updatedAt: at },
      { ownerId: owner, heading: "Lunch ideas", text: "Try the new falafel place.", transcript: "", source, createdAt: at, updatedAt: at },
      { ownerId: new ObjectId(), heading: "Someone else's supplier", text: "Secret supplier price list.", transcript: "", source, createdAt: at, updatedAt: at },
    ]);
    await database().tasks.insertOne({
      ownerId: owner,
      heading: "Call the supplier",
      description: "Call the supplier about the late pallets.",
      due: null,
      status: "open",
      reminderSentAt: null,
      channelIdentity: { channel: "telegram", channelId: "42" },
      transcript: "",
      source,
      createdAt: at,
      updatedAt: at,
    });
  }

  it("answers a question about the User's own items from their matching Notes and Tasks, without the web", async () => {
    await saveItems();
    openRouter.script(MODEL, toolCall("research", { question: "What did I note about the supplier?", web: false }));
    openRouter.script(MODEL, textAnswer("Your supplier contact is Ahmed at Gulf Packaging, ext 214."));

    const { events } = await send("what did I note about the supplier?");

    const result = events.at(-1);
    expect(result).toEqual({
      type: "result",
      result: {
        kind: "researched",
        answer: "Your supplier contact is Ahmed at Gulf Packaging, ext 214.",
        sources: {
          web: [],
          items: expect.arrayContaining([
            { kind: "note", heading: "Supplier contact" },
            { kind: "task", heading: "Call the supplier" },
          ]),
        },
      },
    });
    expect((result as any).result.sources.items).toHaveLength(2);
    const research = openRouter.requests.at(-1)!;
    expect(research.body.plugins).toBeUndefined();
    const sent = JSON.stringify(research.body.messages);
    expect(sent).toContain("Ahmed at Gulf Packaging, ext 214.");
    expect(sent).toContain("Call the supplier about the late pallets.");
    expect(sent).not.toContain("falafel");
    expect(sent).not.toContain("Secret supplier price list");
  });

  it("gives the failure reply when no OpenRouter model answers a web question, never trying the local model", async () => {
    openRouter.script(MODEL, toolCall("research", { question: "VAT rate on exports in the UAE", web: true }));
    openRouter.script(MODEL, { status: 503, body: { error: { message: "overloaded" } } });
    openRouter.script(BACKUP, { status: 429, body: { error: { message: "rate limited" } } });
    openRouter.script(LOCAL_MODEL, textAnswer("This must not be used."));

    const { events, handled } = await send("find out the VAT rate on exports", true);

    expect(events.at(-1)).toEqual({ type: "result", result: { kind: "error" } });
    expect(openRouter.requests.map((request) => request.model)).not.toContain(LOCAL_MODEL);
    const run = (await database().runs.findOne({ _id: new ObjectId(handled.runId!) }))!;
    expect(run.status).toBe("failed");
    expect(run.error?.stage).toBe("research");
    const stage = run.stages.find((candidate) => candidate.name === "research")!;
    expect(stage.outcome).toBe("failed");
    expect((stage.details.attempts as Array<{ model: string; outcome: string }>).map(({ model, outcome }) => ({ model, outcome }))).toEqual([
      { model: MODEL, outcome: "failed" },
      { model: BACKUP, outcome: "failed" },
    ]);
  });

  it("records the Run as research, with what the research stage searched and found", async () => {
    await saveItems();
    openRouter.script(MODEL, toolCall("research", { question: "Who is our packaging supplier and what do they charge?", web: true }));
    openRouter.script(MODEL, textAnswer("Ahmed at Gulf Packaging; their list price is on their site.", [VAT_PAGE]));

    const { handled } = await send("find out who our packaging supplier is and what they charge");

    const run = (await database().runs.findOne({ _id: new ObjectId(handled.runId!) }))!;
    expect(run.status).toBe("succeeded");
    expect(run.type).toBe("research");
    const stage = run.stages.find((candidate) => candidate.name === "research")!;
    expect(stage.outcome).toBe("succeeded");
    expect(stage.details).toEqual({
      web: true,
      matches: 2,
      webSources: 1,
      attempts: [{ model: MODEL, outcome: "succeeded", tokens: { prompt: 500, completion: 60, total: 560 }, cost: 0.0123 }],
    });
  });
});
