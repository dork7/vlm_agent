import type { ObjectId } from "mongodb";
import type { Database, TaskDoc, TaskDue } from "../db.ts";
import { instantToWallClock, wallClockToInstant } from "../time.ts";
import type { Due } from "./classify.ts";
import type { ListedTask } from "./core.ts";

/** The most Tasks one reply lists, so it fits in a single Channel message. */
const LISTED_TASKS_LIMIT = 30;

/** All of the owner's Tasks: open ones soonest due first (undated after), then done ones. */
export async function ownTasksInOrder(database: Database, ownerId: ObjectId, timezone: string): Promise<TaskDoc[]> {
  const tasks = await database.tasks.find({ ownerId }).toArray();
  const dueAt = (due: TaskDue) => dueMoment(due, timezone)?.getTime() ?? Infinity;
  return tasks.toSorted(
    (a, b) =>
      Number(a.status === "done") - Number(b.status === "done") ||
      dueAt(a.due) - dueAt(b.due) ||
      a.createdAt.getTime() - b.createdAt.getTime(),
  );
}

/**
 * The owner's Tasks: open ones soonest due first (undated after), then done ones.
 * With a `date` ("YYYY-MM-DD"), only the Tasks due that day on the owner's own clock.
 */
export async function listTasks(
  database: Database,
  ownerId: ObjectId,
  timezone: string,
  date: string | null = null,
): Promise<{ tasks: ListedTask[]; more: number }> {
  const sorted = (await ownTasksInOrder(database, ownerId, timezone)).filter(
    (task) => date === null || shownDue(task.due, timezone)?.date === date,
  );

  return {
    tasks: sorted.slice(0, LISTED_TASKS_LIMIT).map((task) => ({
      heading: task.heading,
      due: shownDue(task.due, timezone),
      status: task.status,
    })),
    more: Math.max(0, sorted.length - LISTED_TASKS_LIMIT),
  };
}

/**
 * Changes a Task's due date and clears its Reminder sent marker and failed tries, so a new Reminder goes out
 * at the new time. Every due date change (e.g. from the dashboard) goes through here.
 */
export async function changeTaskDue(database: Database, taskId: ObjectId, due: TaskDue, now: () => Date): Promise<void> {
  await database.tasks.updateOne(
    { _id: taskId },
    { $set: { due, reminderSentAt: null, updatedAt: now() }, $unset: { reminderAttempts: "" } },
  );
}

/**
 * Marks one of the owner's Tasks done or open again, e.g. from a Reminder's "Done" button or the dashboard.
 * Returns the Task as it was, or null when the owner has no such Task.
 */
export function setTaskStatus(
  database: Database,
  ownerId: ObjectId,
  taskId: ObjectId,
  status: TaskDoc["status"],
  now: () => Date,
): Promise<TaskDoc | null> {
  return database.tasks.findOneAndUpdate({ _id: taskId, ownerId }, { $set: { status, updatedAt: now() } });
}

/**
 * The due date a User typed: a date ("YYYY-MM-DD") with an optional time ("HH:MM") on their own clock,
 * or neither for no due date. Undefined when it isn't one.
 */
export function dueFromForm(date: string, time: string, timezone: string): TaskDue | undefined {
  if (!date) return time ? undefined : null;
  if (!isCalendarDate(date)) return undefined;
  if (!time) return { kind: "date", date };
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return undefined;
  return { kind: "moment", at: wallClockToInstant(date, time, timezone) };
}

function isCalendarDate(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const parsed = new Date(`${date}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(date);
}

export function sameDue(a: TaskDue, b: TaskDue): boolean {
  if (a === null || b === null) return a === b;
  if (a.kind === "date" && b.kind === "date") return a.date === b.date;
  if (a.kind === "moment" && b.kind === "moment") return a.at.getTime() === b.at.getTime();
  return false;
}

/** The wall-clock time at which a date-only Task falls due on its owner's clock. */
export const DATE_ONLY_DUE_TIME = "09:00";

/** When a Task falls due, and its Reminder goes out: a date-only Task at 09:00 that day in its owner's `timezone`. */
export function dueMoment(due: TaskDue, timezone: string): Date | null {
  if (due === null) return null;
  if (due.kind === "moment") return due.at;
  return wallClockToInstant(due.date, DATE_ONLY_DUE_TIME, timezone);
}

export function shownDue(due: TaskDue, timezone: string): Due {
  if (due === null) return null;
  if (due.kind === "date") return { date: due.date };
  return instantToWallClock(due.at, timezone);
}
