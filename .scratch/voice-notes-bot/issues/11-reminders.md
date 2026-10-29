# 11: Reminders

**What to build:** When a Task falls due, the bot sends its owner a Reminder on the Channel the Task came from. An in-process scheduler calls a core operation "send due Reminders as of time T" every minute. A date-only due date means 09:00 that day in the owner's timezone. Each Reminder is claimed atomically in MongoDB before sending, so it goes out exactly once; Reminders that fell due while the app was down go out on the next start. Done Tasks get no Reminder, and changing a due date schedules a new one. The core emits a channel-neutral Reminder event; the Telegram adapter adds a "Done" button that marks the Task done, and other Channels send plain text. One Reminder per due moment: no advance warnings, repeats or snooze.

**Blocked by:** 02

**Status:** ready-for-agent

- [ ] Through Seam 1, calling the Reminder operation at a time past a Task's due moment emits one Reminder event addressed to the Task's originating Channel Identity and records it as sent.
- [ ] Calling it again, or twice concurrently, does not send a second Reminder.
- [ ] A date-only Task is due at 09:00 in its owner's timezone (tested with two different timezones).
- [ ] Done Tasks are skipped; Tasks not yet due are skipped.
- [ ] A Task whose due moment passed before the operation ran (simulated downtime) is reminded on the next call.
- [ ] After a due date change clears the sent marker, a new Reminder goes out at the new time.
- [ ] On Telegram, the Reminder's "Done" button marks the Task done.
