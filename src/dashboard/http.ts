import { fileURLToPath } from "node:url";
import ejs from "ejs";
import type { FastifyReply, onRequestAsyncHookHandler } from "fastify";
import { ObjectId, type Collection, type Filter, type WithId } from "mongodb";

const VIEWS = fileURLToPath(new URL("./views/", import.meta.url));

/** A submitted HTML form's fields. */
export type Form = Record<string, string> | undefined;

export function field(form: Form, name: string): string {
  const value = form?.[name];
  return typeof value === "string" ? value.trim() : "";
}

/** An ID from a URL, or null when it can't be one. */
export function parseId(id: string): ObjectId | null {
  return ObjectId.isValid(id) && id.length === 24 ? new ObjectId(id) : null;
}

/** One of the owner's own documents (a Note or Task) by its ID from a URL; anyone else's, or none, is null. */
export function findOwn<T extends { ownerId: ObjectId }>(
  collection: Collection<T>,
  ownerId: ObjectId,
  id: string,
): Promise<WithId<T> | null> {
  const _id = parseId(id);
  return _id ? collection.findOne({ _id, ownerId } as Filter<T>) : Promise.resolve(null);
}

/** A hook that lets only admins through; anyone else gets 403 saying they cannot `what`, e.g. "see Runs". */
export function adminOnly(what: string): onRequestAsyncHookHandler {
  return async (request, reply) => {
    if (!request.user.isAdmin) {
      return reply.code(403).type("text/plain").send(`Only admins can ${what}.`);
    }
  };
}

export function notFound(reply: FastifyReply) {
  return reply.code(404).type("text/plain").send("Not found.");
}

export function badRequest(reply: FastifyReply, message: string) {
  return reply.code(400).type("text/plain").send(message);
}

/**
 * Renders a view as the page; every view also gets the logged-in `viewer`. Not in EJS's async mode,
 * in which the views' un-awaited `include` calls would print "[object Promise]".
 */
export async function render(reply: FastifyReply, view: string, data: Record<string, unknown>) {
  const html = await ejs.renderFile(`${VIEWS}${view}.ejs`, { viewer: reply.request.user, ...data });
  return reply.type("text/html; charset=utf-8").send(html);
}
