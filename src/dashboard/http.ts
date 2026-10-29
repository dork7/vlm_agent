import { fileURLToPath } from "node:url";
import ejs from "ejs";
import type { FastifyReply } from "fastify";
import { ObjectId } from "mongodb";

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
