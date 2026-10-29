import { describe, expect, it } from "vitest";
import { createCore, type CoreEvent, type HandledMessage } from "../src/core/core.ts";
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
