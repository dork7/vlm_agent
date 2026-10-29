import { fileURLToPath } from "node:url";
import ejs from "ejs";
import type { FastifyPluginAsync, FastifyReply } from "fastify";
import { ObjectId } from "mongodb";
import { writeMarkdownCopies } from "../core/markdown.ts";
import type { Database, UserDoc } from "../db.ts";
import { formatDay, instantToWallClock } from "../time.ts";
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
    ObjectId.isValid(id) && id.length === 24
      ? database.notes.findOne({ _id: new ObjectId(id), ownerId: user._id! })
      : Promise.resolve(null);

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
