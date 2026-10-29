import type { ObjectId } from "mongodb";
import type { ChannelIdentity, Database, UserDoc } from "../db.ts";
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

/** How many times delivering one Reminder is tried before the bot gives up on it. */
export const MAX_REMINDER_ATTEMPTS = 5;

/**
 * Hands each Reminder to the adapter of the Channel it is addressed to. A Channel with no adapter
 * throws, so the Reminder counts as not delivered rather than sent.
 */
export function deliverByChannel(adapters: Record<string, DeliverReminder>): DeliverReminder {
  return async (reminder) => {
    const deliver = adapters[reminder.to.channel];
    if (!deliver) throw new Error(`No adapter for Channel ${reminder.to.channel}`);
    await deliver(reminder);
  };
}

/**
 * Sends a Reminder for every open Task whose due moment is at or before `asOf` and that has not had one.
 * Each Task is claimed in MongoDB before its Reminder is handed over, so overlapping calls send it once.
 * A Reminder goes only to a Channel Identity its owner still has; a Task whose owner was deleted gets none.
 * A failed delivery is tried again on later calls, up to MAX_REMINDER_ATTEMPTS times in all.
 */
export async function sendDueReminders(
  database: Database,
  defaultTimezone: string,
  asOf: Date,
  deliver: DeliverReminder,
): Promise<void> {
  // No timezone's clock is further ahead than UTC+14, so no date-only Task after that date can be due yet.
  const latestDate = todayIn(asOf, "Pacific/Kiritimati").date;
  const notGivenUp = { reminderAttempts: { $not: { $gte: MAX_REMINDER_ATTEMPTS } } };
  const candidates = await database.tasks
    .find({
      status: "open",
      reminderSentAt: null,
      ...notGivenUp,
      $or: [
        { "due.kind": "moment", "due.at": { $lte: asOf } },
        { "due.kind": "date", "due.date": { $lte: latestDate } },
      ],
    })
    .toArray();

  const owners = new Map<string, UserDoc | null>();
  const ownerOf = async (ownerId: ObjectId) => {
    const key = ownerId.toHexString();
    if (!owners.has(key)) owners.set(key, await database.users.findOne({ _id: ownerId }));
    return owners.get(key)!;
  };

  for (const task of candidates) {
    const owner = await ownerOf(task.ownerId);
    // A deleted owner, or one whose Channel Identity was removed, must not be reminded there.
    if (!owner || !owner.channelIdentities.some((identity) => sameIdentity(identity, task.channelIdentity))) continue;
    const timezone = owner.timezone ?? defaultTimezone;
    if (dueMoment(task.due, timezone)! > asOf) continue;
    const claimed = await database.tasks.findOneAndUpdate(
      { _id: task._id, status: "open", reminderSentAt: null, due: task.due, ...notGivenUp },
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
      const released = await database.tasks.findOneAndUpdate(
        { _id: task._id, reminderSentAt: asOf, due: task.due },
        { $set: { reminderSentAt: null }, $inc: { reminderAttempts: 1 } },
        { returnDocument: "after" },
      );
      const attempts = released?.reminderAttempts ?? 0;
      const givenUp = attempts >= MAX_REMINDER_ATTEMPTS;
      console.error(
        `Failed to deliver the Reminder for Task ${task._id.toHexString()} (attempt ${attempts} of ${MAX_REMINDER_ATTEMPTS}` +
          `${givenUp ? "; giving up" : ""})`,
        error,
      );
    }
  }
}

function sameIdentity(a: ChannelIdentity, b: ChannelIdentity): boolean {
  return a.channel === b.channel && a.channelId === b.channelId;
}
