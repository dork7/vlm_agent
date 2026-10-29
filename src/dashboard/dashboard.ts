import { fileURLToPath } from "node:url";
import ejs from "ejs";
import type { FastifyPluginAsync, FastifyReply } from "fastify";
import { ObjectId } from "mongodb";
import { writeMarkdownCopies } from "../core/markdown.ts";
import { changeTaskDue, ownTasksInOrder, shownDue } from "../core/tasks.ts";
import type { Database, TaskDue, UserDoc } from "../db.ts";
import { formatDay, instantToWallClock, wallClockToInstant } from "../time.ts";
import { authenticate } from "./auth.ts";

export type DashboardOptions = {
  database: Database;
  defaultTimezone: string;
  /** Folder of each User's read-only Markdown copies, rewritten after a change; none are written when absent. */
  markdownDir?: string;
};

declare module "fastify" {
  interface FastifyRequest {
    /** The logged-in dashboard User. */
    user: UserDoc;
  }
}

const VIEWS = fileURLToPath(new URL("./views/", import.meta.url));

/** The server-rendered dashboard, behind HTTP basic auth checked against Users. */
export const dashboardRoutes: FastifyPluginAsync<DashboardOptions> = async (app, options) => {
  const { database, defaultTimezone, markdownDir } = options;
  const timezoneOf = (user: UserDoc) => user.timezone ?? defaultTimezone;

  /** When something happened, on the User's own clock. */
  const shownTime = (user: UserDoc, instant: Date) => {
    const { date, time } = instantToWallClock(instant, timezoneOf(user));
    return `${formatDay(date)}, ${time}`;
  };

  /** A failure to write the copies is logged and never fails the change itself. */
  const refreshMarkdownCopies = async (user: UserDoc) => {
    if (markdownDir === undefined) return;
    try {
      await writeMarkdownCopies(database, user, markdownDir, timezoneOf(user));
    } catch (error) {
      app.log.error(error, `Failed to write Markdown copies for ${user.username}`);
    }
  };

  app.decorateRequest("user", null as unknown as UserDoc);

  // Plain HTML forms post URL-encoded fields.
  app.addContentTypeParser("application/x-www-form-urlencoded", { parseAs: "string" }, (_request, body, done) => {
    done(null, Object.fromEntries(new URLSearchParams(body as string)));
  });

  app.addHook("onRequest", async (request, reply) => {
    const user = await authenticate(database, request.headers.authorization);
    if (!user) {
      return reply
        .code(401)
        .header("www-authenticate", 'Basic realm="Voice Notes Bot", charset="UTF-8"')
        .type("text/plain")
        .send("Log in with your username and password.");
    }
    request.user = user;
  });

  app.get("/", async (_request, reply) => reply.redirect("/tasks"));

  /** A Task's due date for people, on the User's own clock; null when it has none. */
  const shownTaskDue = (user: UserDoc, due: TaskDue) => {
    const shown = shownDue(due, timezoneOf(user));
    return shown && `${formatDay(shown.date)}${shown.time ? `, ${shown.time}` : ""}`;
  };

  app.get<{ Querystring: { tab?: string } }>("/tasks", async (request, reply) => {
    const tab = request.query.tab === "done" ? "done" : "open";
    const tasks = (await ownTasksInOrder(database, request.user._id!, timezoneOf(request.user))).filter(
      (task) => task.status === tab,
    );
    return render(reply, "tasks", { tasks, tab, due: (due: TaskDue) => shownTaskDue(request.user, due) });
  });

  /** One of the User's own Tasks; anyone else's, or none, is not found. */
  const ownTask = (user: UserDoc, id: string) =>
    isObjectId(id) ? database.tasks.findOne({ _id: new ObjectId(id), ownerId: user._id! }) : Promise.resolve(null);

  app.get<{ Params: { id: string } }>("/tasks/:id", async (request, reply) => {
    const task = await ownTask(request.user, request.params.id);
    if (!task) return notFound(reply);
    return render(reply, "task", {
      task,
      due: shownDue(task.due, timezoneOf(request.user)),
      shownDue: shownTaskDue(request.user, task.due),
    });
  });

  app.post<{ Params: { id: string }; Body: Form }>("/tasks/:id", async (request, reply) => {
    const task = await ownTask(request.user, request.params.id);
    if (!task) return notFound(reply);
    const heading = field(request.body, "heading");
    const description = field(request.body, "description");
    if (!heading) return reply.code(400).type("text/plain").send("A Task needs a Heading.");
    const due = dueFromForm(field(request.body, "due_date"), field(request.body, "due_time"), timezoneOf(request.user));
    if (due === undefined) {
      return reply.code(400).type("text/plain").send("Give the due date as a calendar date, and a time only with a date.");
    }

    // The original Transcript is left as it was, so it stays verbatim.
    await database.tasks.updateOne({ _id: task._id }, { $set: { heading, description, updatedAt: new Date() } });
    // A new due date goes through the core, so its Reminder is sent again at the new time.
    if (!sameDue(due, task.due)) await changeTaskDue(database, task._id.toHexString(), due);
    await refreshMarkdownCopies(request.user);
    return reply.redirect(`/tasks/${task._id}`, 303);
  });

  app.post<{ Params: { id: string } }>("/tasks/:id/delete", async (request, reply) => {
    const task = await ownTask(request.user, request.params.id);
    if (!task) return notFound(reply);
    await database.tasks.deleteOne({ _id: task._id });
    await refreshMarkdownCopies(request.user);
    return reply.redirect(task.status === "done" ? "/tasks?tab=done" : "/tasks", 303);
  });

  /** Marking done goes back to the Open tab, reopening back to the Done tab, where the button was. */
  for (const [action, status, from] of [
    ["done", "done", "/tasks"],
    ["reopen", "open", "/tasks?tab=done"],
  ] as const) {
    app.post<{ Params: { id: string } }>(`/tasks/:id/${action}`, async (request, reply) => {
      const task = await ownTask(request.user, request.params.id);
      if (!task) return notFound(reply);
      await database.tasks.updateOne({ _id: task._id }, { $set: { status, updatedAt: new Date() } });
      await refreshMarkdownCopies(request.user);
      return reply.redirect(from, 303);
    });
  }

  app.get<{ Querystring: { q?: string } }>("/notes", async (request, reply) => {
    const search = request.query.q?.trim() ?? "";
    const matching = search ? new RegExp(escapeRegExp(search), "i") : null;
    const notes = await database.notes
      .find({
        ownerId: request.user._id!,
        ...(matching ? { $or: [{ heading: matching }, { text: matching }] } : {}),
      })
      .sort({ createdAt: -1, _id: -1 })
      .toArray();
    return render(reply, "notes", { notes, search, saved: (instant: Date) => shownTime(request.user, instant) });
  });

  /** One of the User's own Notes; anyone else's, or none, is not found. */
  const ownNote = (user: UserDoc, id: string) =>
    isObjectId(id) ? database.notes.findOne({ _id: new ObjectId(id), ownerId: user._id! }) : Promise.resolve(null);

  app.get<{ Params: { id: string } }>("/notes/:id", async (request, reply) => {
    const note = await ownNote(request.user, request.params.id);
    if (!note) return notFound(reply);
    return render(reply, "note", {
      note,
      saved: shownTime(request.user, note.createdAt),
      edited: note.updatedAt > note.createdAt ? shownTime(request.user, note.updatedAt) : null,
    });
  });

  app.post<{ Params: { id: string }; Body: Form }>("/notes/:id", async (request, reply) => {
    const note = await ownNote(request.user, request.params.id);
    if (!note) return notFound(reply);
    const heading = field(request.body, "heading");
    const text = field(request.body, "text");
    if (!heading || !text) return reply.code(400).type("text/plain").send("A Note needs a Heading and text.");

    // The original Transcript is left as it was, so it stays verbatim.
    await database.notes.updateOne({ _id: note._id }, { $set: { heading, text, updatedAt: new Date() } });
    await refreshMarkdownCopies(request.user);
    return reply.redirect(`/notes/${note._id}`, 303);
  });

  app.post<{ Params: { id: string } }>("/notes/:id/delete", async (request, reply) => {
    const note = await ownNote(request.user, request.params.id);
    if (!note) return notFound(reply);
    await database.notes.deleteOne({ _id: note._id });
    await refreshMarkdownCopies(request.user);
    return reply.redirect("/notes", 303);
  });
};

/** A submitted HTML form's fields. */
type Form = Record<string, string> | undefined;

function field(form: Form, name: string): string {
  const value = form?.[name];
  return typeof value === "string" ? value.trim() : "";
}

/**
 * The due date a User typed: a date ("YYYY-MM-DD") with an optional time ("HH:MM") on their own clock,
 * or neither for no due date. Undefined when it isn't one.
 */
function dueFromForm(date: string, time: string, timezone: string): TaskDue | undefined {
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

function sameDue(a: TaskDue, b: TaskDue): boolean {
  if (a === null || b === null) return a === b;
  if (a.kind === "date" && b.kind === "date") return a.date === b.date;
  if (a.kind === "moment" && b.kind === "moment") return a.at.getTime() === b.at.getTime();
  return false;
}

/** Whether an ID from a URL is a well-formed MongoDB ObjectId. */
function isObjectId(id: string): boolean {
  return ObjectId.isValid(id) && id.length === 24;
}

function notFound(reply: FastifyReply) {
  return reply.code(404).type("text/plain").send("Not found.");
}

async function render(reply: FastifyReply, view: string, data: Record<string, unknown>) {
  const html = await ejs.renderFile(`${VIEWS}${view}.ejs`, data, { async: true });
  return reply.type("text/html; charset=utf-8").send(html);
}

/** Text to search for, made safe to use as a pattern. */
function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
