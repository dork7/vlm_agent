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
  // A date-only Task counts as due at 09:00 that day, the same moment its Reminder will go out.
  const dueAt = (due: TaskDue) =>
    due === null
      ? Infinity
      : due.kind === "moment"
        ? due.at.getTime()
        : wallClockToInstant(due.date, "09:00", timezone).getTime();
  return tasks.toSorted(
    (a, b) =>
      Number(a.status === "done") - Number(b.status === "done") ||
      dueAt(a.due) - dueAt(b.due) ||
      a.createdAt.getTime() - b.createdAt.getTime(),
  );
}

/** The owner's Tasks: open ones soonest due first (undated after), then done ones. */
export async function listTasks(
  database: Database,
  ownerId: ObjectId,
  timezone: string,
): Promise<{ tasks: ListedTask[]; more: number }> {
  const sorted = await ownTasksInOrder(database, ownerId, timezone);

  return {
    tasks: sorted.slice(0, LISTED_TASKS_LIMIT).map((task) => ({
      heading: task.heading,
      due: shownDue(task.due, timezone),
      status: task.status,
    })),
    more: Math.max(0, sorted.length - LISTED_TASKS_LIMIT),
  };
}

export function shownDue(due: TaskDue, timezone: string): Due {
  if (due === null) return null;
  if (due.kind === "date") return { date: due.date };
  return instantToWallClock(due.at, timezone);
}
