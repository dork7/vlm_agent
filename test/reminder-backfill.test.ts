import type { ObjectId } from "mongodb";
import { describe, expect, it } from "vitest";
import { backfillReminderMarkers, sendDueReminders, type ReminderEvent } from "../src/core/reminders.ts";
import type { TaskDoc, TaskDue } from "../src/db.ts";
import { hashPassword } from "../src/users.ts";
import { useMemoryMongo } from "./fakes/memory-mongo.ts";

const NOW = new Date("2026-10-29T06:00:00Z"); // 10:00 on 29 October in Dubai (UTC+4)

describe("migration: Tasks saved before Reminders existed", () => {
  const database = useMemoryMongo();

  async function owner(): Promise<ObjectId> {
    const { insertedId } = await database().users.insertOne({
      username: "owner",
      password: hashPassword("pw"),
      isAdmin: false,
      timezone: "Asia/Dubai",
      channelIdentities: [{ channel: "telegram", channelId: "42" }],
      createdAt: new Date(),
    });
    return insertedId;
  }

  /** A Task as saved before Reminders existed: it has no reminderSentAt field at all. */
  async function oldTask(ownerId: ObjectId, heading: string, due: TaskDue, status: TaskDoc["status"] = "open") {
    const { reminderSentAt: _, ...task } = taskDoc(ownerId, heading, due, status);
    await database().tasks.insertOne(task as TaskDoc);
  }

  async function newTask(ownerId: ObjectId, heading: string, due: TaskDue) {
    await database().tasks.insertOne(taskDoc(ownerId, heading, due, "open"));
  }

  async function marker(heading: string) {
    const task = await database().tasks.findOne({ heading });
    return task && "reminderSentAt" in task ? task.reminderSentAt : "missing";
  }

  async function remindAsOf(asOf: Date): Promise<string[]> {
    const sent: ReminderEvent[] = [];
    await sendDueReminders(database(), "UTC", asOf, async (reminder) => {
      sent.push(reminder);
    });
    return sent.map((reminder) => reminder.heading);
  }

  it("marks old Tasks that are already due as reminded, so no burst of Reminders goes out", async () => {
    const ownerId = await owner();
    await oldTask(ownerId, "Call the supplier", { kind: "moment", at: new Date("2026-10-20T11:00:00Z") });
    // A date-only Task falls due at 09:00 on the owner's clock, an hour before NOW.
    await oldTask(ownerId, "Send the invoice", { kind: "date", date: "2026-10-29" });

    await backfillReminderMarkers(database(), "UTC", NOW);

    expect(await marker("Call the supplier")).toEqual(NOW);
    expect(await marker("Send the invoice")).toEqual(NOW);
    expect(await remindAsOf(NOW)).toEqual([]);
  });

  it("still reminds old Tasks that fall due later", async () => {
    const ownerId = await owner();
    await oldTask(ownerId, "Pay rent", { kind: "date", date: "2026-10-31" });
    await oldTask(ownerId, "Fix the shelf", null);

    await backfillReminderMarkers(database(), "UTC", NOW);

    expect(await marker("Pay rent")).toBeNull();
    expect(await marker("Fix the shelf")).toBeNull();
    expect(await remindAsOf(new Date("2026-10-31T06:00:00Z"))).toEqual(["Pay rent"]);
  });

  it("marks done old Tasks too, so reopening one later doesn't send a stale Reminder", async () => {
    const ownerId = await owner();
    await oldTask(ownerId, "Order mugs", { kind: "date", date: "2026-10-01" }, "done");

    await backfillReminderMarkers(database(), "UTC", NOW);

    expect(await marker("Order mugs")).toEqual(NOW);
  });

  it("leaves Tasks saved since Reminders existed alone", async () => {
    const ownerId = await owner();
    await newTask(ownerId, "Book the car service", { kind: "moment", at: new Date("2026-10-28T05:00:00Z") });

    await backfillReminderMarkers(database(), "UTC", NOW);

    expect(await marker("Book the car service")).toBeNull();
    expect(await remindAsOf(NOW)).toEqual(["Book the car service"]);
  });

  it("changes nothing when run again, and says how many Tasks it marked", async () => {
    const ownerId = await owner();
    await oldTask(ownerId, "Call the supplier", { kind: "moment", at: new Date("2026-10-20T11:00:00Z") });
    await oldTask(ownerId, "Pay rent", { kind: "date", date: "2026-10-31" });

    const first = await backfillReminderMarkers(database(), "UTC", NOW);
    const second = await backfillReminderMarkers(database(), "UTC", new Date("2026-11-05T00:00:00Z"));

    expect(first).toEqual({ markedReminded: 1, leftToRemind: 1 });
    expect(second).toEqual({ markedReminded: 0, leftToRemind: 0 });
    expect(await marker("Pay rent")).toBeNull();
  });
});

function taskDoc(ownerId: ObjectId, heading: string, due: TaskDue, status: TaskDoc["status"]): TaskDoc {
  const at = new Date("2026-10-01T05:30:00Z");
  return {
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
  };
}
