import { ObjectId } from "mongodb";
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
 * Changes a Task's due date and clears its Reminder sent marker, so a new Reminder goes out at the new time.
 * Every due date change (e.g. from the dashboard) goes through here.
 */
export async function changeTaskDue(database: Database, taskId: string, due: TaskDue): Promise<void> {
  await database.tasks.updateOne(
    { _id: new ObjectId(taskId) },
    { $set: { due, reminderSentAt: null, updatedAt: new Date() } },
  );
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
