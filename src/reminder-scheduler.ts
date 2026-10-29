import type { Core, DeliverReminder } from "./core/core.ts";

const EVERY_MINUTE = 60_000;

/**
 * Sends due Reminders now (catching up on any missed while the app was down) and then every minute.
 * A check still running when the next is due is not overlapped. Returns a function that stops it.
 */
export function startReminderScheduler(core: Core, deliver: DeliverReminder, intervalMs = EVERY_MINUTE): () => void {
  let running = false;
  const check = async () => {
    if (running) return;
    running = true;
    try {
      await core.sendDueReminders(new Date(), deliver);
    } catch (error) {
      console.error("Checking for due Reminders failed", error);
    } finally {
      running = false;
    }
  };
  void check();
  const timer = setInterval(check, intervalMs);
  return () => clearInterval(timer);
}
