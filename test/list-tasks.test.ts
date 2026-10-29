import type { ObjectId } from "mongodb";
import { describe, expect, it } from "vitest";
import { createCore, type CoreEvent } from "../src/core/core.ts";
import type { TaskDoc, TaskDue } from "../src/db.ts";
import { createOpenRouter } from "../src/llm/openrouter.ts";
import { ensureFirstAdmin, findUserByChannelIdentity, hashPassword } from "../src/users.ts";
import { toolCall, useFakeOpenRouter } from "./fakes/fake-openrouter.ts";
import { useMemoryMongo } from "./fakes/memory-mongo.ts";
import { unusedInventory, unusedTranscriber } from "./fakes/unused.ts";

const MODEL = "test/model-a";

describe("core: asking to see my Tasks", () => {
  const database = useMemoryMongo();
  const openRouter = useFakeOpenRouter();

  async function owner(): Promise<ObjectId> {
    await ensureFirstAdmin(database(), {
      username: "owner",
      password: "pw",
      telegramId: "42",
      timezone: "Asia/Dubai",
    });
    return (await findUserByChannelIdentity(database(), { channel: "telegram", channelId: "42" }))!._id!;
  }

  async function someoneElse(): Promise<ObjectId> {
    const { insertedId } = await database().users.insertOne({
      username: "colleague",
      password: hashPassword("pw"),
      isAdmin: false,
      timezone: "Asia/Dubai",
      channelIdentities: [{ channel: "telegram", channelId: "77" }],
      createdAt: new Date(),
    });
    return insertedId;
  }

  // Tasks are saved here directly: marking one done is only possible from the dashboard.
  async function saveTask(ownerId: ObjectId, heading: string, due: TaskDue, status: TaskDoc["status"] = "open") {
    const at = new Date("2026-10-27T05:30:00Z");
    await database().tasks.insertOne({
      ownerId,
      heading,
      description: `${heading}.`,
      due,
      status,
      reminderSentAt: null,
      channelIdentity: { channel: "telegram", channelId: "42" },
      transcript: heading,
      source: { channel: "telegram", chatId: "chat-42", messageId: heading },
      createdAt: at,
      updatedAt: at,
    });
  }

  async function ask(text = "show tasks", args: Record<string, unknown> = {}): Promise<CoreEvent[]> {
    openRouter.script(MODEL, toolCall("list_tasks", args));
    const llm = createOpenRouter({ apiKey: "key", baseUrl: openRouter.baseUrl, models: [MODEL] });
    const core = createCore({ database: database(), llm, inventory: unusedInventory, transcriber: unusedTranscriber, defaultTimezone: "UTC" });
    const events: CoreEvent[] = [];
    await core.handleMessage(
      {
        sender: { channel: "telegram", channelId: "42" },
        chatId: "chat-42",
        messageId: "3001",
        content: { kind: "text", text },
      },
      async (event) => {
        events.push(event);
      },
    );
    return events;
  }

  it("lists the User's open Tasks soonest due first, undated after, then done ones, saving nothing", async () => {
    const ownerId = await owner();
    // 15:00 on 30 October in Dubai (UTC+4).
    await saveTask(ownerId, "Call the supplier", { kind: "moment", at: new Date("2026-10-30T11:00:00Z") });
    await saveTask(ownerId, "Fix the shelf", null);
    await saveTask(ownerId, "Send the invoice", { kind: "date", date: "2026-10-28" });
    await saveTask(ownerId, "Order mugs", { kind: "date", date: "2026-10-01" }, "done");

    const events = await ask();

    expect(events).toEqual([
      { type: "processing-started" },
      {
        type: "result",
        result: {
          kind: "tasks-listed",
          tasks: [
            { heading: "Send the invoice", due: { date: "2026-10-28" }, status: "open" },
            { heading: "Call the supplier", due: { date: "2026-10-30", time: "15:00" }, status: "open" },
            { heading: "Fix the shelf", due: null, status: "open" },
            { heading: "Order mugs", due: { date: "2026-10-01" }, status: "done" },
          ],
          more: 0,
          date: null,
        },
      },
    ]);
    expect(await database().tasks.countDocuments()).toBe(4);
    expect(await database().notes.countDocuments()).toBe(0);
  });

  it("never lists another User's Tasks", async () => {
    const ownerId = await owner();
    await saveTask(ownerId, "Call the supplier", null);
    await saveTask(await someoneElse(), "Colleague's secret plan", null);

    const events = await ask();

    expect(events.at(-1)).toEqual({
      type: "result",
      result: {
        kind: "tasks-listed",
        tasks: [{ heading: "Call the supplier", due: null, status: "open" }],
        more: 0,
        date: null,
      },
    });
  });

  it("lists nothing when the User has no Tasks", async () => {
    await owner();
    await saveTask(await someoneElse(), "Colleague's task", null);

    const events = await ask("what's on my list?");

    expect(events.at(-1)).toEqual({ type: "result", result: { kind: "tasks-listed", tasks: [], more: 0, date: null } });
  });

  it("cuts a long list to 30 Tasks and says how many more there are", async () => {
    const ownerId = await owner();
    for (let day = 1; day <= 35; day++) {
      await saveTask(ownerId, `Task for day ${day}`, { kind: "date", date: `2026-12-${String(day % 31 || 31).padStart(2, "0")}` });
    }

    const events = await ask();

    const result = events.at(-1);
    expect(result?.type === "result" && result.result.kind === "tasks-listed").toBe(true);
    if (result?.type !== "result" || result.result.kind !== "tasks-listed") return;
    expect(result.result.tasks).toHaveLength(30);
    expect(result.result.more).toBe(5);
  });

  it("lists only the Tasks due on the day asked about, on the User's own clock", async () => {
    const ownerId = await owner();
    // 15:00 on 30 October in Dubai (UTC+4).
    await saveTask(ownerId, "Call the supplier", { kind: "moment", at: new Date("2026-10-30T11:00:00Z") });
    await saveTask(ownerId, "Send the invoice", { kind: "date", date: "2026-10-30" });
    await saveTask(ownerId, "Order mugs", { kind: "date", date: "2026-10-30" }, "done");
    // Still 30 October in UTC, but 01:00 on the 31st in Dubai.
    await saveTask(ownerId, "Late-night delivery", { kind: "moment", at: new Date("2026-10-30T21:00:00Z") });
    await saveTask(ownerId, "Pay rent", { kind: "date", date: "2026-10-31" });
    await saveTask(ownerId, "Fix the shelf", null);

    const events = await ask("what's due on Friday?", { date: "2026-10-30" });

    expect(events.at(-1)).toEqual({
      type: "result",
      result: {
        kind: "tasks-listed",
        tasks: [
          // A date-only Task counts as due at 09:00, so it comes before the 15:00 one.
          { heading: "Send the invoice", due: { date: "2026-10-30" }, status: "open" },
          { heading: "Call the supplier", due: { date: "2026-10-30", time: "15:00" }, status: "open" },
          { heading: "Order mugs", due: { date: "2026-10-30" }, status: "done" },
        ],
        more: 0,
        date: "2026-10-30",
      },
    });
  });

  it("lists nothing when no Task is due on the day asked about", async () => {
    const ownerId = await owner();
    await saveTask(ownerId, "Pay rent", { kind: "date", date: "2026-10-31" });

    const events = await ask("anything due tomorrow?", { date: "2026-10-30" });

    expect(events.at(-1)).toEqual({
      type: "result",
      result: { kind: "tasks-listed", tasks: [], more: 0, date: "2026-10-30" },
    });
  });

  it("treats a day that isn't a real date as an unusable answer", async () => {
    await owner();

    const events = await ask("what's due on the 31st?", { date: "2026-11-31" });

    expect(events.at(-1)).toEqual({ type: "result", result: { kind: "error" } });
  });

  it("offers the model a way to ask for the Task list", async () => {
    await owner();

    await ask();

    const tools = openRouter.requests[0]!.body.tools.map((tool: any) => tool.function.name);
    expect(tools).toContain("list_tasks");
  });
});
