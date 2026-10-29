import { mkdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Database, NoteDoc, TaskDoc, UserDoc } from "../db.ts";
import { formatDay, instantToWallClock } from "../time.ts";
import type { Due } from "./classify.ts";
import { ownTasksInOrder, shownDue } from "./tasks.ts";

/** Rewrites the User's `tasks.md` and `notes.md` in full from MongoDB, which stays the source of truth. */
export async function writeMarkdownCopies(
  database: Database,
  user: UserDoc,
  markdownDir: string,
  timezone: string,
): Promise<void> {
  const tasks = await ownTasksInOrder(database, user._id!, timezone);
  const notes = await database.notes.find({ ownerId: user._id! }).sort({ createdAt: -1, _id: -1 }).toArray();

  const folder = join(markdownDir, folderName(user.username));
  await mkdir(folder, { recursive: true });
  await writeAtomically(join(folder, "tasks.md"), tasksMarkdown(tasks, timezone));
  await writeAtomically(join(folder, "notes.md"), notesMarkdown(notes, timezone));
}

function tasksMarkdown(tasks: TaskDoc[], timezone: string): string {
  if (tasks.length === 0) return "# Tasks\n\nNo Tasks yet.\n";
  const items = tasks.map((task) => {
    const box = task.status === "done" ? "[x]" : "[ ]";
    const description = task.description.split("\n").map((line) => `  ${line}`);
    return [`- ${box} ${task.heading}${dueSuffix(shownDue(task.due, timezone))}`, ...description].join("\n");
  });
  return `# Tasks\n\n${items.join("\n")}\n`;
}

function notesMarkdown(notes: NoteDoc[], timezone: string): string {
  if (notes.length === 0) return "# Notes\n\nNo Notes yet.\n";
  const sections = notes.map((note) => {
    const saved = instantToWallClock(note.createdAt, timezone);
    return `## ${note.heading}\n\n_${formatDay(saved.date)}, ${saved.time}_\n\n${note.text}\n`;
  });
  return `# Notes\n\n${sections.join("\n")}`;
}

function dueSuffix(due: Due): string {
  if (due === null) return "";
  return ` (due ${formatDay(due.date)}${due.time ? `, ${due.time}` : ""})`;
}

/** A username made safe to use as one folder name. */
function folderName(username: string): string {
  const safe = username.replace(/[^\w.-]/g, "_");
  return /^\.*$/.test(safe) ? `_${safe}` : safe;
}

/** Writes via a temporary file so a reader never sees a half-written copy. */
async function writeAtomically(path: string, content: string): Promise<void> {
  const temporary = `${path}.tmp`;
  await writeFile(temporary, content, "utf8");
  await rename(temporary, path);
}
