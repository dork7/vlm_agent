import { describe, expect, it } from "vitest";
import { createCore, type CoreEvent, type EventSource, type HandledMessage } from "../src/core/core.ts";
import { createOpenRouter } from "../src/llm/openrouter.ts";
import { ensureFirstAdmin } from "../src/users.ts";
import { toolCall, useFakeOpenRouter } from "./fakes/fake-openrouter.ts";
import { useMemoryMongo } from "./fakes/memory-mongo.ts";
import { unusedInventory, unusedTranscriber } from "./fakes/unused.ts";

const FIRST = "test/first";
const SECOND = "test/second";
const THIRD = "test/third";

describe("core: model fallback list", () => {
  const database = useMemoryMongo();
  const openRouter = useFakeOpenRouter();

  async function send(text: string): Promise<{ events: CoreEvent[]; handled: HandledMessage }> {
    await ensureFirstAdmin(database(), { username: "owner", password: "pw", telegramId: "42", timezone: "UTC" });
    const llm = createOpenRouter({ apiKey: "key", baseUrl: openRouter.baseUrl, models: [FIRST, SECOND, THIRD] });
    const core = createCore({ database: database(), llm, inventory: unusedInventory, transcriber: unusedTranscriber, defaultTimezone: "UTC" });
    const events: CoreEvent[] = [];
    const handled = await core.handleMessage(
      {
        sender: { channel: "telegram", channelId: "42" },
        chatId: "chat-42",
        messageId: "1001",
        content: { kind: "text", text },
        clarifyWith: "buttons",
      },
      async (event) => {
        events.push(event);
      },
    );
    return { events, handled };
  }

  it("caps the answer's length, so a small balance can afford the request", async () => {
    openRouter.script(FIRST, toolCall("save_note", { heading: "Dentist's new number" }));

    await send("The dentist's new number is 555 0199");

    expect(openRouter.requests[0]!.body.max_tokens).toBe(1024);
  });

  it("moves to the next model when a model's request fails", async () => {
    openRouter.script(FIRST, { status: 429, body: { error: { message: "rate limited" } } });
    openRouter.script(SECOND, toolCall("save_note", { heading: "Dentist's new number" }));

    const { events, handled } = await send("Remember the dentist's new number");

    expect(events.at(-1)).toEqual({ type: "result", result: { kind: "note-saved", heading: "Dentist's new number" } });
    expect(await database().notes.countDocuments()).toBe(1);
    expect(openRouter.requests.map((request) => request.model)).toEqual([FIRST, SECOND]);
    expect(handled.modelAttempts).toEqual([
      { model: FIRST, outcome: "failed", reason: expect.stringContaining("429") },
      { model: SECOND, outcome: "succeeded" },
    ]);
  });

  it("moves to the next model when a model's answer leaves out a required field", async () => {
    openRouter.script(FIRST, toolCall("save_task", { heading: "Book the car service" }));
    openRouter.script(SECOND, toolCall("save_task", { heading: "Book the car service", description: "Call the garage" }));

    const { events, handled } = await send("I need to book the car service");

    expect(events.at(-1)).toEqual({
      type: "result",
      result: { kind: "task-saved", heading: "Book the car service", due: null },
    });
    expect(await database().tasks.countDocuments()).toBe(1);
    expect(handled.modelAttempts).toEqual([
      { model: FIRST, outcome: "failed", reason: expect.stringContaining("description") },
      { model: SECOND, outcome: "succeeded" },
    ]);
  });

  it("moves on past an unknown tool and past arguments that are not JSON", async () => {
    openRouter.script(FIRST, toolCall("delete_everything", {}));
    openRouter.script(SECOND, {
      status: 200,
      body: { choices: [{ message: { tool_calls: [{ function: { name: "save_note", arguments: "{heading:" } }] } }] },
    });
    openRouter.script(THIRD, toolCall("save_note", { heading: "Dentist's new number" }));

    const { events, handled } = await send("Remember the dentist's new number");

    expect(events.at(-1)).toEqual({ type: "result", result: { kind: "note-saved", heading: "Dentist's new number" } });
    expect(handled.modelAttempts).toEqual([
      { model: FIRST, outcome: "failed", reason: expect.stringContaining("delete_everything") },
      { model: SECOND, outcome: "failed", reason: expect.stringContaining("JSON") },
      { model: THIRD, outcome: "succeeded" },
    ]);
  });

  it("produces an error result, saves nothing and keeps every attempt when every model fails", async () => {
    openRouter.script(FIRST, { status: 503, body: { error: { message: "overloaded" } } });
    openRouter.script(SECOND, toolCall("save_note", { heading: " " }));
    openRouter.script(THIRD, { status: 200, body: { choices: [{ message: { content: "It's a Note!" } }] } });

    const { events, handled } = await send("Remember the dentist's new number");

    expect(events).toEqual([{ type: "processing-started" }, { type: "result", result: { kind: "error" } }]);
    expect(await database().notes.countDocuments()).toBe(0);
    expect(await database().tasks.countDocuments()).toBe(0);
    expect(handled.modelAttempts).toEqual([
      { model: FIRST, outcome: "failed", reason: expect.stringContaining("503") },
      { model: SECOND, outcome: "failed", reason: expect.stringContaining("heading") },
      { model: THIRD, outcome: "failed", reason: expect.stringContaining("did not call a tool") },
    ]);
  });

  it("tries only the first model when it answers", async () => {
    openRouter.script(FIRST, toolCall("save_note", { heading: "Dentist's new number" }));

    const { handled } = await send("Remember the dentist's new number");

    expect(openRouter.requests.map((request) => request.model)).toEqual([FIRST]);
    expect(handled.modelAttempts).toEqual([{ model: FIRST, outcome: "succeeded" }]);
  });
});

describe("core: the local model server as the last fallback", () => {
  const database = useMemoryMongo();
  const openRouter = useFakeOpenRouter();
  const local = useFakeOpenRouter();

  async function send(text: string): Promise<{ events: CoreEvent[]; handled: HandledMessage }> {
    await ensureFirstAdmin(database(), { username: "owner", password: "pw", telegramId: "42", timezone: "UTC" });
    const llm = createOpenRouter({
      apiKey: "key",
      baseUrl: openRouter.baseUrl,
      models: [FIRST],
      local: { baseUrl: local.baseUrl },
    });
    const core = createCore({ database: database(), llm, inventory: unusedInventory, transcriber: unusedTranscriber, defaultTimezone: "UTC" });
    const events: CoreEvent[] = [];
    const handled = await core.handleMessage(
      {
        sender: { channel: "telegram", channelId: "42" },
        chatId: "chat-42",
        messageId: "2001",
        content: { kind: "text", text },
        clarifyWith: "buttons",
      },
      async (event) => {
        events.push(event);
      },
    );
    return { events, handled };
  }

  it("asks the local server for its models and uses one when every OpenRouter model fails", async () => {
    openRouter.script(FIRST, { status: 429, body: { error: { message: "free-models-per-day" } } });
    local.models = ["local-chat"];
    local.script("local-chat", toolCall("save_note", { heading: "Dentist's new number" }));

    const { events, handled } = await send("Remember the dentist's new number");

    expect(events.at(-1)).toEqual({ type: "result", result: { kind: "note-saved", heading: "Dentist's new number" } });
    expect(local.requests[0]!.body.max_tokens).toBe(1024);
    expect(handled.modelAttempts).toEqual([
      { model: FIRST, outcome: "failed", reason: expect.stringContaining("429") },
      { model: "local/local-chat", outcome: "succeeded" },
    ]);
  });

  it("skips models that can't chat and tries each of the rest in turn", async () => {
    openRouter.script(FIRST, { status: 503, body: { error: { message: "overloaded" } } });
    local.models = ["audioldm2", "granite-embedding-107m", "broken-chat", "good-chat"];
    local.script("broken-chat", { status: 500, body: { error: { message: "model failed to load" } } });
    local.script("good-chat", toolCall("save_note", { heading: "Dentist's new number" }));

    const { handled } = await send("Remember the dentist's new number");

    expect(local.requests.map((request) => request.model)).toEqual(["broken-chat", "good-chat"]);
    expect(handled.modelAttempts.map((attempt) => [attempt.model, attempt.outcome])).toEqual([
      [FIRST, "failed"],
      ["local/broken-chat", "failed"],
      ["local/good-chat", "succeeded"],
    ]);
  });

  it("records the failed listing and gives the error result when the local server can't list its models", async () => {
    openRouter.script(FIRST, { status: 503, body: { error: { message: "overloaded" } } });
    local.models = null;

    const { events, handled } = await send("Remember the dentist's new number");

    expect(events.at(-1)).toEqual({ type: "result", result: { kind: "error" } });
    expect(handled.modelAttempts).toEqual([
      { model: FIRST, outcome: "failed", reason: expect.stringContaining("503") },
      { model: "local", outcome: "failed", reason: expect.stringContaining("500") },
    ]);
  });

  it("isn't asked when an OpenRouter model answers", async () => {
    openRouter.script(FIRST, toolCall("save_note", { heading: "Dentist's new number" }));
    local.models = ["local-chat"];

    await send("Remember the dentist's new number");

    expect(local.requests).toEqual([]);
  });
});

describe("core: saying which side processed a message", () => {
  const database = useMemoryMongo();
  const openRouter = useFakeOpenRouter();
  const local = useFakeOpenRouter();

  /** Each event emitted, with the source passed along with it. */
  async function send(text: string): Promise<Array<{ event: CoreEvent; source: EventSource | undefined }>> {
    await ensureFirstAdmin(database(), { username: "owner", password: "pw", telegramId: "42", timezone: "UTC" });
    const llm = createOpenRouter({ apiKey: "key", baseUrl: openRouter.baseUrl, models: [FIRST], local: { baseUrl: local.baseUrl } });
    const core = createCore({ database: database(), llm, inventory: unusedInventory, transcriber: unusedTranscriber, defaultTimezone: "UTC" });
    const emitted: Array<{ event: CoreEvent; source: EventSource | undefined }> = [];
    await core.handleMessage(
      {
        sender: { channel: "telegram", channelId: "42" },
        chatId: "chat-42",
        messageId: "3001",
        content: { kind: "text", text },
        clarifyWith: "buttons",
      },
      async (event, source) => {
        emitted.push({ event, source });
      },
    );
    return emitted;
  }

  it("says OpenRouter processed it when an OpenRouter model answered", async () => {
    openRouter.script(FIRST, toolCall("save_note", { heading: "Dentist's new number" }));

    const emitted = await send("Remember the dentist's new number");

    expect(emitted.at(-1)).toEqual({
      event: { type: "result", result: { kind: "note-saved", heading: "Dentist's new number" } },
      source: { processedBy: "openrouter" },
    });
  });

  it("says local AI processed it when a local model answered", async () => {
    openRouter.script(FIRST, { status: 429, body: { error: { message: "rate limited" } } });
    local.models = ["local-chat"];
    local.script("local-chat", toolCall("ask_clarification", {}));

    const emitted = await send("the supplier thing");

    expect(emitted.at(-1)!.event.type).toBe("clarification-needed");
    expect(emitted.at(-1)!.source).toEqual({ processedBy: "local" });
  });

  it("names no source when no model answered", async () => {
    openRouter.script(FIRST, { status: 503, body: { error: { message: "overloaded" } } });
    local.models = [];

    const emitted = await send("Remember the dentist's new number");

    expect(emitted.at(-1)).toEqual({ event: { type: "result", result: { kind: "error" } }, source: undefined });
  });
});
