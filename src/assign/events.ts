import { EventEmitter } from "node:events";
import type { ObjectId } from "mongodb";
import type { AssignContext } from "./context.ts";
import type { EventDoc } from "./store.ts";

export const hub = new EventEmitter();
hub.setMaxListeners(0);

export async function recordEvent(ctx: AssignContext, ownerId: ObjectId, kind: string, details: Partial<EventDoc> = {}) {
  const counter = await ctx.store.counters.findOneAndUpdate({ name: "events" }, { $inc: { seq: 1 } }, { upsert: true, returnDocument: "after" });
  const event: EventDoc = { ownerId, seq: counter!.seq, kind, createdAt: ctx.now(), ...details };
  await ctx.store.events.insertOne(event);
  hub.emit(ownerId.toHexString(), event);
  return event;
}
