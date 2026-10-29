import type { ObjectId } from "mongodb";
import type { ChannelIdentity, Database } from "../db.ts";
import { todayIn } from "../time.ts";
import type { Due } from "./classify.ts";
import { dueMoment, shownDue } from "./tasks.ts";

/** A Reminder for one Task that fell due, addressed to the Channel Identity the Task came from. */
export type ReminderEvent = {
  type: "reminder";
  to: ChannelIdentity;
  taskId: string;
  heading: string;
  /** The due date and optional time on the owner's own clock. */
  due: Due;
};

/** Hands a Reminder to its Channel; throwing means it was not delivered. */
export type DeliverReminder = (reminder: ReminderEvent) => Promise<void>;

/**
 * Sends a Reminder for every open Task whose due moment is at or before `asOf` and that has not had one.
 * Each Task is claimed in MongoDB before its Reminder is handed over, so overlapping calls send it once.
 */
export async function sendDueReminders(
  database: Database,
  defaultTimezone: string,
  asOf: Date,
  deliver: DeliverReminder,
): Promise<void> {
  // No timezone's clock is further ahead than UTC+14, so no date-only Task after that date can be due yet.
  const latestDate = todayIn(asOf, "Pacific/Kiritimati").date;
  const candidates = await database.tasks
    .find({
      status: "open",
      reminderSentAt: null,
      $or: [
        { "due.kind": "moment", "due.at": { $lte: asOf } },
        { "due.kind": "date", "due.date": { $lte: latestDate } },
      ],
    })
    .toArray();

  const timezones = new Map<string, string>();
  const timezoneOf = async (ownerId: ObjectId) => {
    const key = ownerId.toHexString();
    if (!timezones.has(key)) {
      const owner = await database.users.findOne({ _id: ownerId });
      timezones.set(key, owner?.timezone ?? defaultTimezone);
    }
    return timezones.get(key)!;
  };

  for (const task of candidates) {
    const timezone = await timezoneOf(task.ownerId);
    if (dueMoment(task.due, timezone)! > asOf) continue;
    const claimed = await database.tasks.findOneAndUpdate(
      { _id: task._id, status: "open", reminderSentAt: null, due: task.due },
      { $set: { reminderSentAt: asOf } },
    );
    if (!claimed) continue;
    try {
      await deliver({
        type: "reminder",
        to: task.channelIdentity,
        taskId: task._id.toHexString(),
        heading: task.heading,
        due: shownDue(task.due, timezone),
      });
    } catch (error) {
      // Release the claim so the next check tries again, unless the due date changed meanwhile.
      console.error(`Failed to deliver the Reminder for Task ${task._id.toHexString()}`, error);
      await database.tasks.updateOne(
        { _id: task._id, reminderSentAt: asOf, due: task.due },
        { $set: { reminderSentAt: null } },
      );
    }
  }
}
