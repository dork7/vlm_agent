import { ObjectId } from "mongodb";
import { wallClockToInstant } from "../time.ts";
import type { AgentsStore, AppointmentDoc, AppointmentState } from "./types.ts";

/** The only moves an Appointment can make; nothing else, and nobody but the Property Agent, advances it past "requested". */
const TRANSITIONS: Record<AppointmentState, AppointmentState[]> = {
  requested: ["confirmed", "declined"],
  confirmed: ["location-shared"],
  declined: [],
  "location-shared": [],
};

export type Transition = { ok: true; appointment: AppointmentDoc & { _id: ObjectId } } | { ok: false; reason: "not-found" | "invalid"; current?: AppointmentState };

/** Moves an Appointment to `to` if the state machine allows it from its current state; a repeat or invalid move changes nothing. */
export async function transitionAppointment(
  store: AgentsStore,
  id: ObjectId,
  to: AppointmentState,
  extra: Partial<AppointmentDoc> = {},
  now: () => Date = () => new Date(),
): Promise<Transition> {
  const from = (Object.keys(TRANSITIONS) as AppointmentState[]).filter((s) => TRANSITIONS[s].includes(to));
  const moved = await store.appointments.findOneAndUpdate(
    { _id: id, state: { $in: from } },
    { $set: { state: to, ...(to === "location-shared" ? { locationSharedAt: now() } : { decidedAt: now() }), ...extra } },
    { returnDocument: "after" },
  );
  if (moved) return { ok: true, appointment: moved as AppointmentDoc & { _id: ObjectId } };
  const current = await store.appointments.findOne({ _id: id });
  return current ? { ok: false, reason: "invalid", current: current.state } : { ok: false, reason: "not-found" };
}

/** A date ("YYYY-MM-DD") and time ("HH:MM") on the bot's wall clock as an instant; null when they are not real or already past. */
export function parseViewingTime(date: string, time: string, timezone: string, now: Date): Date | { error: string } {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) {
    return { error: "date must be YYYY-MM-DD and time must be HH:MM (24-hour)." };
  }
  const [h, m] = time.split(":").map(Number) as [number, number];
  const [y, mo, d] = date.split("-").map(Number) as [number, number, number];
  const check = new Date(Date.UTC(y, mo - 1, d));
  if (h > 23 || m > 59 || check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) {
    return { error: "That is not a real date or time." };
  }
  const at = wallClockToInstant(date, time, timezone);
  if (Number.isNaN(at.getTime())) return { error: "That is not a real date or time." };
  if (at.getTime() <= now.getTime()) return { error: "That time is in the past. Ask the customer for a future date and time." };
  return at;
}

export function describeAppointment(a: Pick<AppointmentDoc, "listingSummary" | "scheduledFor" | "customer">, timezone: string, format: (d: Date, tz: string) => string): string {
  return `${a.listingSummary} on ${format(a.scheduledFor, timezone)}`;
}
