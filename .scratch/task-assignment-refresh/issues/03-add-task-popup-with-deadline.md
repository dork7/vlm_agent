# 03: Add Task popup with Deadline

**What to build:** "Add Task" is a button opening a modal dialog with Title, Tags, Instructions and an optional **Deadline** (date and time). Picking only a date makes the time the end of that day in the Owner's time zone. The Deadline is stored as one moment in time and shown to Owner and Assignee in their own time zones, collapsed and expanded. A not-Done Task past its Deadline is marked Overdue in colour and text. The Owner can edit the Deadline later; the Assignee cannot. A failed validation reopens the dialog with input and error. Spec stories 1–11.

**Blocked by:** 02

**Status:** ready-for-agent

- [ ] Inline add form is replaced by the dialog with the same fields and limits.
- [ ] Date-only becomes end of day; unparseable input is rejected.
- [ ] Overdue is never shown on a Done Task.
- [ ] The Assignee has no way to change a Deadline, enforced server-side.
- [ ] Covered by tests through the existing HTTP workflow test seam.
