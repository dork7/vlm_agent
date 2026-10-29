import { fileURLToPath } from "node:url";
import ejs from "ejs";
import type { FastifyReply } from "fastify";

const VIEWS = fileURLToPath(new URL("./views/", import.meta.url));

/** Renders a view as the page; every view also gets the logged-in `viewer`. */
export async function render(reply: FastifyReply, view: string, data: Record<string, unknown>) {
  const html = await ejs.renderFile(`${VIEWS}${view}.ejs`, { viewer: reply.request.user, ...data });
  return reply.type("text/html; charset=utf-8").send(html);
}

export function notFound(reply: FastifyReply) {
  return reply.code(404).type("text/plain").send("Not found.");
}
