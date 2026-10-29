import { describe, expect, it } from "vitest";
import { createCore, type CoreEvent, type InboundMessage } from "../src/core/core.ts";
import { createOpenRouter } from "../src/llm/openrouter.ts";
import { ensureFirstAdmin, findUserByChannelIdentity } from "../src/users.ts";
import { toolCall, toolCalls, useFakeOpenRouter } from "./fakes/fake-openrouter.ts";
import { useMemoryMongo } from "./fakes/memory-mongo.ts";
import { unusedInventory } from "./fakes/unused-inventory.ts";

const MODEL = "test/model-a";
// Tuesday 27 October 2026, 09:30 in Dubai (UTC+4, no daylight saving).
const NOW = new Date("2026-10-27T05:30:00Z");

describe("core: a message meant as a Task", () => {
  const database = useMemoryMongo();
  const openRouter = useFakeOpenRouter();

  async function send(text: string, timezone = "Asia/Dubai", defaultTimezone = "UTC"): Promise<CoreEvent[]> {
    await ensureFirstAdmin(database(), { username: "owner", password: "pw", telegramId: "42", timezone });
    const llm = createOpenRouter({ apiKey: "key", baseUrl: openRouter.baseUrl, models: [MODEL] });
    const core = createCore({ database: database(), llm, inventory: unusedInventory, defaultTimezone, now: () => NOW });
    const message: InboundMessage = {
      sender: { channel: "telegram", channelId: "42" },
      chatId: "chat-42",
      messageId: "2001",
      content: { kind: "text", text },
    };
    const events: CoreEvent[] = [];
    await core.handleMessage(message, async (event) => {
      events.push(event);
    });
    return events;
  }

  it("becomes an open Task with its Heading, Description, Transcript and originating Channel Identity", async () => {
    openRouter.script(
      MODEL,
      toolCall("save_task", {
        heading: "Call the supplier",
        description: "Call the supplier about the late delivery.",
        due_date: "2026-10-29",
        due_time: "15:00",
      }),
    );

    const events = await send("Call the supplier Thursday at 3 about the late delivery");

    expect(events).toEqual([
      { type: "processing-started" },
      {
        type: "result",
        result: { kind: "task-saved", heading: "Call the supplier", due: { date: "2026-10-29", time: "15:00" } },
      },
    ]);
    const owner = await findUserByChannelIdentity(database(), { channel: "telegram", channelId: "42" });
    const tasks = await database().tasks.find().toArray();
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({
      ownerId: owner!._id,
      heading: "Call the supplier",
      description: "Call the supplier about the late delivery.",
      status: "open",
      transcript: "Call the supplier Thursday at 3 about the late delivery",
      channelIdentity: { channel: "telegram", channelId: "42" },
    });
    expect(await database().notes.countDocuments()).toBe(0);
  });

  it("stores a due date with a time as that moment in the User's timezone", async () => {
    openRouter.script(
      MODEL,
      toolCall("save_task", { heading: "Call the supplier", description: "Call.", due_date: "2026-10-29", due_time: "15:00" }),
    );

    await send("Call the supplier Thursday at 3");

    const [task] = await database().tasks.find().toArray();
    // 15:00 in Dubai (UTC+4) is 11:00 UTC.
    expect(task!.due).toEqual({ kind: "moment", at: new Date("2026-10-29T11:00:00Z") });
  });

  it("follows daylight saving in the User's timezone", async () => {
    openRouter.script(
      MODEL,
      toolCall("save_task", { heading: "Pay rent", description: "Pay rent.", due_date: "2026-11-02", due_time: "09:00" }),
    );

    await send("Pay rent next Monday at 9am", "Europe/London");

    const [task] = await database().tasks.find().toArray();
    // London is back on GMT (UTC+0) after 25 October 2026.
    expect(task!.due).toEqual({ kind: "moment", at: new Date("2026-11-02T09:00:00Z") });
  });

  it("moves a time skipped by clocks going forward to the same wall time after the jump", async () => {
    openRouter.script(
      MODEL,
      toolCall("save_task", { heading: "Water plants", description: "Water.", due_date: "2026-03-08", due_time: "02:30" }),
    );

    await send("Water the plants on 8 March at 2:30am", "America/New_York");

    const [task] = await database().tasks.find().toArray();
    // New York jumps from 02:00 EST to 03:00 EDT; 02:30 never happens, so it becomes 03:30 EDT.
    expect(task!.due).toEqual({ kind: "moment", at: new Date("2026-03-08T07:30:00Z") });
  });

  it("picks the first occurrence of a time repeated by clocks going back", async () => {
    openRouter.script(
      MODEL,
      toolCall("save_task", { heading: "Check boiler", description: "Check.", due_date: "2026-11-01", due_time: "01:30" }),
    );

    await send("Check the boiler on 1 November at 1:30am", "America/New_York");

    const [task] = await database().tasks.find().toArray();
    // 01:30 happens twice in New York that night; the first is 01:30 EDT (UTC-4).
    expect(task!.due).toEqual({ kind: "moment", at: new Date("2026-11-01T05:30:00Z") });
  });

  it("uses the configured default timezone for a User without one", async () => {
    openRouter.script(
      MODEL,
      toolCall("save_task", { heading: "Call the supplier", description: "Call.", due_date: "2026-10-29", due_time: "15:00" }),
    );
    await ensureFirstAdmin(database(), { username: "owner", password: "pw", telegramId: "42", timezone: "UTC" });
    await database().users.updateMany({}, { $unset: { timezone: "" } });

    await send("Call the supplier Thursday at 3", "UTC", "Asia/Dubai");

    const [task] = await database().tasks.find().toArray();
    expect(task!.due).toEqual({ kind: "moment", at: new Date("2026-10-29T11:00:00Z") });
    expect(JSON.stringify(openRouter.requests[0]!.body.messages)).toContain("Asia/Dubai");
  });

  it("stores a due date without a time as date-only", async () => {
    openRouter.script(
      MODEL,
      toolCall("save_task", { heading: "Send the invoice", description: "Send the invoice.", due_date: "2026-10-30" }),
    );

    const events = await send("Send the invoice on Friday");

    expect(events.at(-1)).toEqual({
      type: "result",
      result: { kind: "task-saved", heading: "Send the invoice", due: { date: "2026-10-30" } },
    });
    const [task] = await database().tasks.find().toArray();
    expect(task!.due).toEqual({ kind: "date", date: "2026-10-30" });
  });

  it("leaves the due date empty when none is mentioned", async () => {
    openRouter.script(MODEL, toolCall("save_task", { heading: "Fix the shelf", description: "Fix the shelf." }));

    const events = await send("I need to fix the shelf");

    expect(events.at(-1)).toEqual({
      type: "result",
      result: { kind: "task-saved", heading: "Fix the shelf", due: null },
    });
    const [task] = await database().tasks.find().toArray();
    expect(task!.due).toBeNull();
  });

  it("saves exactly one Task for a message with several to-dos", async () => {
    openRouter.script(
      MODEL,
      toolCalls([
        ["save_task", { heading: "Call the supplier", description: "Call the supplier, and send the invoice." }],
        ["save_task", { heading: "Send the invoice", description: "Send the invoice." }],
      ]),
    );

    await send("Call the supplier, and send the invoice");

    const tasks = await database().tasks.find().toArray();
    expect(tasks).toHaveLength(1);
    expect(tasks[0]!.description).toBe("Call the supplier, and send the invoice.");
  });

  it("tells the model today's date and the User's timezone so it can resolve relative dates", async () => {
    openRouter.script(MODEL, toolCall("save_task", { heading: "Call the supplier", description: "Call." }));

    await send("Call the supplier Thursday");

    const prompt = JSON.stringify(openRouter.requests[0]!.body.messages);
    expect(prompt).toContain("2026-10-27");
    expect(prompt).toContain("Tuesday");
    expect(prompt).toContain("Asia/Dubai");
  });

  it.each([
    ["a malformed due date", { heading: "Call", description: "Call.", due_date: "next Thursday" }],
    ["a time without a date", { heading: "Call", description: "Call.", due_time: "15:00" }],
    ["no Description", { heading: "Call" }],
  ])("produces an error result and stores nothing for %s", async (_, args) => {
    openRouter.script(MODEL, toolCall("save_task", args));

    const events = await send("Call the supplier");

    expect(events.at(-1)).toEqual({ type: "result", result: { kind: "error" } });
    expect(await database().tasks.countDocuments()).toBe(0);
  });

  it("still saves a Note for a message meant to be remembered", async () => {
    openRouter.script(MODEL, toolCall("save_note", { heading: "Supplier closes early on Fridays" }));

    const events = await send("Remember the supplier closes early on Fridays");

    expect(events.at(-1)).toEqual({
      type: "result",
      result: { kind: "note-saved", heading: "Supplier closes early on Fridays" },
    });
    expect(await database().tasks.countDocuments()).toBe(0);
    expect(await database().notes.countDocuments()).toBe(1);
  });
});
