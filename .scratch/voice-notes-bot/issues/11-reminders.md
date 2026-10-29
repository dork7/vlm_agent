# 11: Reminders

**What to build:** When a Task falls due, the bot sends its owner a Reminder on the Channel the Task came from. An in-process scheduler calls a core operation "send due Reminders as of time T" every minute. A date-only due date means 09:00 that day in the owner's timezone. Each Reminder is claimed atomically in MongoDB before sending, so it goes out exactly once; Reminders that fell due while the app was down go out on the next start. Done Tasks get no Reminder, and changing a due date schedules a new one. The core emits a channel-neutral Reminder event; the Telegram adapter adds a "Done" button that marks the Task done, and other Channels send plain text. One Reminder per due moment: no advance warnings, repeats or snooze.

**Blocked by:** 02

**Status:** ready-for-agent

- [x] Through Seam 1, calling the Reminder operation at a time past a Task's due moment emits one Reminder event addressed to the Task's originating Channel Identity and records it as sent.
- [x] Calling it again, or twice concurrently, does not send a second Reminder.
- [x] A date-only Task is due at 09:00 in its owner's timezone (tested with two different timezones).
- [x] Done Tasks are skipped; Tasks not yet due are skipped.
- [x] A Task whose due moment passed before the operation ran (simulated downtime) is reminded on the next call.
- [x] After a due date change clears the sent marker, a new Reminder goes out at the new time.
- [x] On Telegram, the Reminder's "Done" button marks the Task done.

## Comments

- Implemented. The core exposes `sendDueReminders(asOf, deliver)` and `completeTask(sender, taskId)`; `src/reminder-scheduler.ts` runs the check on startup (catching up on Reminders missed while down) and then every minute, never overlapping itself. `main.ts` hands Telegram Reminders to `sendTelegramReminder`; a Reminder for a Channel with no adapter is logged and counted as sent.
- Each Task is claimed with a conditional `findOneAndUpdate` (open, `reminderSentAt: null`, same due) that sets `reminderSentAt` before delivery, so overlapping checks send it once. If the Channel fails to deliver, the claim is released and the next check tries again (a Reminder can repeat only if delivery throws after Telegram actually sent it).
- Date-only Tasks fall due at 09:00 on the owner's clock (`dueMoment` in `src/core/tasks.ts`, now shared with the Task listing order).
- `changeTaskDue` in `src/core/tasks.ts` sets a new due date and clears `reminderSentAt`. There is no editing UI yet: ticket 09's dashboard edit should call it (and refresh the Markdown copies) rather than updating `due` directly.
- The "Done" button (`done:<Task ID>`) marks the Task done only for its owner (matched by Channel Identity), rewrites the Markdown copies, and edits the Reminder into "Done: <Heading>". Covered at Seam 1 (`completeTask`) and through the webhook with a stub core.
- Not checked manually on real Telegram yet: a Reminder arriving at its due minute and the Done button closing the Task.
- Code review fixes: a Reminder goes out only if the Task's owner still exists and still has the Channel Identity the Task came from. Otherwise it is skipped and not claimed, so the Heading never reaches an account that is refused. `main.ts` now delivers through `deliverByChannel` in `src/core/reminders.ts`, which throws for a Channel with no adapter. Such a Reminder therefore counts as not delivered instead of being silently counted as sent. A failed delivery adds one to `reminderAttempts` on the Task and is tried again on later checks, up to `MAX_REMINDER_ATTEMPTS` (5). After that the bot gives up and logs it, and the count stays on the Task. `changeTaskDue` clears the count along with `reminderSentAt`. Removed the unused `intervalMs` parameter of `startReminderScheduler`.
