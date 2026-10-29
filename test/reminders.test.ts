import { ObjectId } from "mongodb";
import { describe, expect, it } from "vitest";
import { createCore, type ReminderEvent } from "../src/core/core.ts";
import { deliverByChannel } from "../src/core/reminders.ts";
import { changeTaskDue } from "../src/core/tasks.ts";
import type { TaskDoc, TaskDue } from "../src/db.ts";
import { createOpenRouter } from "../src/llm/openrouter.ts";
import { hashPassword } from "../src/users.ts";
import { useFakeOpenRouter } from "./fakes/fake-openrouter.ts";
import { useMemoryMongo } from "./fakes/memory-mongo.ts";
import { unusedInventory, unusedTranscriber } from "./fakes/unused.ts";

describe("core: Reminders when Tasks fall due", () => {
  const database = useMemoryMongo();
  const openRouter = useFakeOpenRouter();

  function core() {
    const llm = createOpenRouter({ apiKey: "key", baseUrl: openRouter.baseUrl, models: ["test/model-a"] });
    return createCore({ database: database(), llm, inventory: unusedInventory, transcriber: unusedTranscriber, defaultTimezone: "UTC" });
  }

  async function user(username: string, channelId: string, timezone: string): Promise<ObjectId> {
    const { insertedId } = await database().users.insertOne({
      username,
      password: hashPassword("pw"),
      isAdmin: false,
      timezone,
      channelIdentities: [{ channel: "telegram", channelId }],
      createdAt: new Date(),
    });
    return insertedId;
  }

  // Tasks are saved here directly, as the dashboard (ticket 09) or a Task message would leave them.
  async function saveTask(
    ownerId: ObjectId,
    heading: string,
    due: TaskDue,
    options: { status?: TaskDoc["status"]; channelId?: string } = {},
  ): Promise<string> {
    const at = new Date("2026-10-27T05:30:00Z");
    const { insertedId } = await database().tasks.insertOne({
      ownerId,
      heading,
      description: `${heading}.`,
      due,
      status: options.status ?? "open",
      reminderSentAt: null,
      channelIdentity: { channel: "telegram", channelId: options.channelId ?? "42" },
      transcript: heading,
      source: { channel: "telegram", chatId: "chat-42", messageId: heading },
      createdAt: at,
      updatedAt: at,
    });
    return insertedId.toHexString();
  }

  async function remindAsOf(asOf: string, sut = core()): Promise<ReminderEvent[]> {
    const sent: ReminderEvent[] = [];
    await sut.sendDueReminders(new Date(asOf), async (reminder) => {
      sent.push(reminder);
    });
    return sent;
  }

  it("sends one Reminder to the Task's originating Channel Identity once its due moment has passed", async () => {
    const owner = await user("owner", "42", "Asia/Dubai");
    // 15:00 on Thursday 29 October in Dubai (UTC+4).
    const taskId = await saveTask(owner, "Call the supplier", { kind: "moment", at: new Date("2026-10-29T11:00:00Z") });

    const sent = await remindAsOf("2026-10-29T11:00:30Z");

    expect(sent).toEqual([
      {
        type: "reminder",
        to: { channel: "telegram", channelId: "42" },
        taskId,
        heading: "Call the supplier",
        due: { date: "2026-10-29", time: "15:00" },
      },
    ]);
  });

  it("does not send a second Reminder when called again", async () => {
    const owner = await user("owner", "42", "Asia/Dubai");
    await saveTask(owner, "Call the supplier", { kind: "moment", at: new Date("2026-10-29T11:00:00Z") });

    expect(await remindAsOf("2026-10-29T11:00:30Z")).toHaveLength(1);
    expect(await remindAsOf("2026-10-29T11:01:30Z")).toEqual([]);
  });

  it("sends only one Reminder when two checks overlap", async () => {
    const owner = await user("owner", "42", "Asia/Dubai");
    for (let i = 0; i < 5; i++) await saveTask(owner, `Task ${i}`, { kind: "moment", at: new Date("2026-10-29T11:00:00Z") });

    // Two schedulers (or a slow check overlapping the next) racing over the same Tasks.
    const [first, second] = await Promise.all([
      remindAsOf("2026-10-29T11:00:30Z", core()),
      remindAsOf("2026-10-29T11:00:30Z", core()),
    ]);

    expect([...first, ...second].map((reminder) => reminder.heading).toSorted()).toEqual([
      "Task 0",
      "Task 1",
      "Task 2",
      "Task 3",
      "Task 4",
    ]);
  });

  it("skips Tasks not yet due and done Tasks", async () => {
    const owner = await user("owner", "42", "Asia/Dubai");
    await saveTask(owner, "Later today", { kind: "moment", at: new Date("2026-10-29T11:01:00Z") });
    await saveTask(owner, "Tomorrow", { kind: "date", date: "2026-10-30" });
    await saveTask(owner, "No due date", null);
    await saveTask(owner, "Already done", { kind: "moment", at: new Date("2026-10-29T10:00:00Z") }, { status: "done" });

    expect(await remindAsOf("2026-10-29T11:00:30Z")).toEqual([]);
  });

  it("reminds about a date-only Task at 09:00 that day in its owner's timezone", async () => {
    const dubai = await user("dubai", "42", "Asia/Dubai");
    const newYork = await user("new-york", "77", "America/New_York");
    await saveTask(dubai, "Send the invoice", { kind: "date", date: "2026-10-30" }, { channelId: "42" });
    await saveTask(newYork, "Pay rent", { kind: "date", date: "2026-10-30" }, { channelId: "77" });

    const headings = async (asOf: string) => (await remindAsOf(asOf)).map((reminder) => reminder.heading);

    // 09:00 in Dubai (UTC+4) is 05:00 UTC; 09:00 in New York (EDT, UTC-4) is 13:00 UTC.
    expect(await headings("2026-10-30T04:59:00Z")).toEqual([]);
    expect(await headings("2026-10-30T05:00:00Z")).toEqual(["Send the invoice"]);
    expect(await headings("2026-10-30T12:59:00Z")).toEqual([]);
    expect(await headings("2026-10-30T13:00:00Z")).toEqual(["Pay rent"]);
  });

  it("shows a date-only Task's Reminder with its date and no time", async () => {
    const owner = await user("owner", "42", "Asia/Dubai");
    await saveTask(owner, "Send the invoice", { kind: "date", date: "2026-10-30" });

    const [reminder] = await remindAsOf("2026-10-30T05:00:00Z");

    expect(reminder!.due).toEqual({ date: "2026-10-30" });
  });

  it("sends a new Reminder at the new time after the due date is changed", async () => {
    const owner = await user("owner", "42", "Asia/Dubai");
    const taskId = await saveTask(owner, "Call the supplier", { kind: "moment", at: new Date("2026-10-29T11:00:00Z") });
    expect(await remindAsOf("2026-10-29T11:00:30Z")).toHaveLength(1);

    // Moved to Friday 30 October, date only: due at 09:00 Dubai time, 05:00 UTC.
    await changeTaskDue(database(), new ObjectId(taskId), { kind: "date", date: "2026-10-30" }, () => new Date("2026-10-29T12:00:00Z"));

    expect(await remindAsOf("2026-10-30T04:59:00Z")).toEqual([]);
    expect(await remindAsOf("2026-10-30T05:00:00Z")).toEqual([
      {
        type: "reminder",
        to: { channel: "telegram", channelId: "42" },
        taskId,
        heading: "Call the supplier",
        due: { date: "2026-10-30" },
      },
    ]);
    expect(await remindAsOf("2026-10-30T05:01:00Z")).toEqual([]);
  });

  it("tries a Reminder the Channel failed to deliver again on the next check, without holding up the others", async () => {
    const owner = await user("owner", "42", "Asia/Dubai");
    await saveTask(owner, "Call the supplier", { kind: "moment", at: new Date("2026-10-29T11:00:00Z") });
    await saveTask(owner, "Send the invoice", { kind: "moment", at: new Date("2026-10-29T11:00:00Z") });
    const delivered: string[] = [];

    await core().sendDueReminders(new Date("2026-10-29T11:00:30Z"), async (reminder) => {
      if (reminder.heading === "Call the supplier") throw new Error("Telegram is unreachable");
      delivered.push(reminder.heading);
    });

    expect(delivered).toEqual(["Send the invoice"]);
    expect((await remindAsOf("2026-10-29T11:01:30Z")).map((reminder) => reminder.heading)).toEqual(["Call the supplier"]);
  });

  it("gives up on a Reminder after 5 failed deliveries, keeping the count on the Task", async () => {
    const owner = await user("owner", "42", "Asia/Dubai");
    await saveTask(owner, "Call the supplier", { kind: "moment", at: new Date("2026-10-29T11:00:00Z") });
    let tries = 0;
    const failing = async () => {
      tries++;
      throw new Error("Telegram is unreachable");
    };

    for (let minute = 1; minute <= 7; minute++) {
      await core().sendDueReminders(new Date(`2026-10-29T11:0${minute}:00Z`), failing);
    }

    expect(tries).toBe(5);
    expect(await database().tasks.findOne({})).toMatchObject({ reminderAttempts: 5, reminderSentAt: null });
  });

  it("tries again from the start after the due date of a Task it gave up on is changed", async () => {
    const owner = await user("owner", "42", "Asia/Dubai");
    const taskId = await saveTask(owner, "Call the supplier", { kind: "moment", at: new Date("2026-10-29T11:00:00Z") });
    for (let minute = 1; minute <= 5; minute++) {
      await core().sendDueReminders(new Date(`2026-10-29T11:0${minute}:00Z`), async () => {
        throw new Error("Telegram is unreachable");
      });
    }

    await changeTaskDue(database(), new ObjectId(taskId), { kind: "date", date: "2026-10-30" }, () => new Date());

    expect((await remindAsOf("2026-10-30T05:00:00Z")).map((reminder) => reminder.heading)).toEqual(["Call the supplier"]);
  });

  it("sends no Reminder to a Channel Identity the owner no longer has", async () => {
    const owner = await user("owner", "42", "Asia/Dubai");
    await saveTask(owner, "Call the supplier", { kind: "moment", at: new Date("2026-10-29T11:00:00Z") });
    await database().users.updateOne({ _id: owner }, { $set: { channelIdentities: [{ channel: "telegram", channelId: "43" }] } });

    expect(await remindAsOf("2026-10-29T11:00:30Z")).toEqual([]);
  });

  it("sends no Reminder for a Task whose owner no longer exists", async () => {
    const owner = await user("owner", "42", "Asia/Dubai");
    await saveTask(owner, "Call the supplier", { kind: "moment", at: new Date("2026-10-29T11:00:00Z") });
    await database().users.deleteOne({ _id: owner });

    expect(await remindAsOf("2026-10-29T11:00:30Z")).toEqual([]);
  });

  it("counts a Reminder for a Channel with no adapter as not delivered", async () => {
    const telegram: ReminderEvent[] = [];
    const deliver = deliverByChannel({
      telegram: async (reminder) => {
        telegram.push(reminder);
      },
    });
    const reminder = (channel: string): ReminderEvent => ({
      type: "reminder",
      to: { channel, channelId: "42" },
      taskId: "6720a1b2c3d4e5f6a7b8c9d0",
      heading: "Call the supplier",
      due: null,
    });

    await deliver(reminder("telegram"));
    await expect(deliver(reminder("whatsapp"))).rejects.toThrow(/whatsapp/);
    expect(telegram).toHaveLength(1);
  });

  it("marks the reminded Task done when its owner answers the Reminder with Done", async () => {
    const owner = await user("owner", "42", "Asia/Dubai");
    const taskId = await saveTask(owner, "Call the supplier", { kind: "moment", at: new Date("2026-10-29T11:00:00Z") });

    const result = await core().completeTask({ channel: "telegram", channelId: "42" }, taskId);

    expect(result).toEqual({ kind: "task-done", heading: "Call the supplier" });
    expect(await database().tasks.findOne({})).toMatchObject({ status: "done" });
  });

  it("does not let anyone but the Task's owner mark it done", async () => {
    const owner = await user("owner", "42", "Asia/Dubai");
    await user("colleague", "77", "Asia/Dubai");
    const taskId = await saveTask(owner, "Call the supplier", { kind: "moment", at: new Date("2026-10-29T11:00:00Z") });

    expect(await core().completeTask({ channel: "telegram", channelId: "77" }, taskId)).toEqual({ kind: "task-not-found" });
    expect(await core().completeTask({ channel: "telegram", channelId: "99" }, taskId)).toEqual({ kind: "task-not-found" });
    expect(await core().completeTask({ channel: "telegram", channelId: "42" }, "not-an-id")).toEqual({ kind: "task-not-found" });
    expect(await database().tasks.findOne({})).toMatchObject({ status: "open" });
  });

  it("sends a Reminder that fell due while the bot was not running on the next check", async () => {
    const owner = await user("owner", "42", "Asia/Dubai");
    await saveTask(owner, "Call the supplier", { kind: "moment", at: new Date("2026-10-29T11:00:00Z") });

    // The bot was down from before 15:00 until two days later.
    const sent = await remindAsOf("2026-10-31T08:00:00Z");

    expect(sent.map((reminder) => reminder.heading)).toEqual(["Call the supplier"]);
  });
});
