import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { AssignContext } from "./context.ts";
import { currentOwner } from "./auth.ts";
import { hub } from "./events.ts";
import type { EventDoc } from "./store.ts";
import { ObjectId } from "mongodb";

function send(reply: FastifyReply, kind: string, event?: EventDoc) {
  reply.raw.write(`${event ? `id: ${event.seq}\n` : ""}event: ${kind}\ndata: ${JSON.stringify(event ? { kind: event.kind, seq: event.seq, taskId: event.taskId?.toHexString(), listId: event.listId?.toHexString(), personId: event.personId?.toHexString(), summary: event.summary } : {})}\n\n`);
}
async function stream(ctx: AssignContext, request: FastifyRequest, reply: FastifyReply, ownerId: string, listId?: string) {
  reply.hijack();
  reply.raw.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive", "x-accel-buffering": "no" });
  reply.raw.write(": connected\n\n");
  const relevant = (event: EventDoc) => !listId || event.listId?.toHexString() === listId;
  const seen = new Set<number>();
  const pending: EventDoc[] = [];
  let replaying = true;
  const deliver = (event: EventDoc) => {
    if (seen.has(event.seq) || reply.raw.destroyed) return;
    seen.add(event.seq);
    if (!relevant(event)) return;
    if (listId && ["assignment.revoke", "list.delete", "person.delete"].includes(event.kind)) { send(reply, "revoked", event); reply.raw.end(); return; }
    send(reply, "change", event);
  };
  const onEvent = (event: EventDoc) => { if (replaying) pending.push(event); else deliver(event); };
  hub.on(ownerId, onEvent);
  const rawLast = request.headers["last-event-id"];
  const last = rawLast === undefined ? 0 : Number(rawLast);
  if (rawLast !== undefined && (!Number.isSafeInteger(last) || last < 1)) send(reply, "reset");
  else if (last) {
    const latest = await ctx.store.events.findOne({ ownerId: new ObjectId(ownerId) }, { sort: { seq: -1 } });
    const known = await ctx.store.events.findOne({ ownerId: new ObjectId(ownerId), seq: last });
    if (!known || (latest && latest.seq - last > 500)) send(reply, "reset");
    else {
      const missed = await ctx.store.events.find({ ownerId: known.ownerId, seq: { $gt: last } }).sort({ seq: 1 }).toArray();
      for (const event of missed) deliver(event);
    }
  }
  replaying = false;
  for (const event of pending) deliver(event);
  const heartbeat = setInterval(() => reply.raw.write(": heartbeat\n\n"), 20_000);
  reply.raw.on("close", () => { clearInterval(heartbeat); hub.off(ownerId, onEvent); });
}
export function registerSse(app: FastifyInstance, ctx: AssignContext) {
  app.get("/assign/events", async (request, reply) => {
    const owner = await currentOwner(ctx, request, reply);
    if (!owner) return reply.code(302).header("location", "/assign/login").send();
    return stream(ctx, request, reply, owner._id.toHexString());
  });
  app.get("/l/:code/events", async (request, reply) => {
    const code = (request.params as { code: string }).code;
    const assignment = await ctx.store.assignments.findOne({ code, active: true });
    if (!assignment) return reply.code(404).send("Link no longer available.");
    return stream(ctx, request, reply, assignment.ownerId.toHexString(), assignment.listId.toHexString());
  });
}
