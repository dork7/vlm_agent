import type { FastifyPluginAsync } from "fastify";
import { writeMarkdownCopies } from "../core/markdown.ts";
import { changeTaskDue, dueFromForm, ownTasksInOrder, sameDue, setTaskStatus, shownDue } from "../core/tasks.ts";
import type { Database, TaskDue, UserDoc } from "../db.ts";
import { formatDay, formatInstant } from "../time.ts";
import { authenticate } from "./auth.ts";
import { badRequest, field, findOwn, notFound, parseId, render, type Form } from "./http.ts";
import { runRoutes } from "./runs.ts";
import { usersPortalRoutes } from "./users-portal.ts";

export type DashboardOptions = {
  database: Database;
  defaultTimezone: string;
  /** Folder of each User's read-only Markdown copies, rewritten after a change; none are written when absent. */
  markdownDir?: string;
  now?: () => Date;
};

declare module "fastify" {
  interface FastifyRequest {
    /** The logged-in dashboard User. */
    user: UserDoc;
  }
}

/** The server-rendered dashboard, behind HTTP basic auth checked against Users. */
export const dashboardRoutes: FastifyPluginAsync<DashboardOptions> = async (app, options) => {
  const { database, defaultTimezone, markdownDir, now = () => new Date() } = options;
  const timezoneOf = (user: UserDoc) => user.timezone ?? defaultTimezone;

  /** When something happened, on the User's own clock. */
  const shownTime = (user: UserDoc, instant: Date) => formatInstant(instant, timezoneOf(user));

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
  const ownTask = (user: UserDoc, id: string) => findOwn(database.tasks, user._id!, id);

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
    if (!heading) return badRequest(reply, "A Task needs a Heading.");
    const due = dueFromForm(field(request.body, "due_date"), field(request.body, "due_time"), timezoneOf(request.user));
    if (due === undefined) {
      return badRequest(reply, "Give the due date as a calendar date, and a time only with a date.");
    }

    // The original Transcript is left as it was, so it stays verbatim.
    await database.tasks.updateOne({ _id: task._id }, { $set: { heading, description, updatedAt: now() } });
    // A new due date goes through the core, so its Reminder is sent again at the new time.
    if (!sameDue(due, task.due)) await changeTaskDue(database, task._id, due, now);
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
      const id = parseId(request.params.id);
      const task = id && (await setTaskStatus(database, request.user._id!, id, status, now));
      if (!task) return notFound(reply);
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
  const ownNote = (user: UserDoc, id: string) => findOwn(database.notes, user._id!, id);

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
    if (!heading || !text) return badRequest(reply, "A Note needs a Heading and text.");

    // The original Transcript is left as it was, so it stays verbatim.
    await database.notes.updateOne({ _id: note._id }, { $set: { heading, text, updatedAt: now() } });
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

  // Child plugins, so they share this login but add their own admin-only check.
  await app.register(usersPortalRoutes, { database, defaultTimezone });
  await app.register(runRoutes, { database, timezoneOf });
};

/** Text to search for, made safe to use as a pattern. */
function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
