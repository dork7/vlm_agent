# 13: List my Tasks from the chat

**What to build:** A User types or says something like "show tasks" or "what's on my list?" and the bot replies with all of that User's saved Tasks instead of saving a new Note or Task. The classifier gains one more outcome, "list my Tasks", alongside Note, Task, Query and unclear. The list is read straight from MongoDB (not through a model tool): open Tasks first, soonest due first and undated ones after them, then done Tasks marked as done, each with its Heading and due date. The core emits a channel-neutral result event carrying the Tasks, and the Telegram adapter formats it as one message, edited into the processing reply. See spec story 78 and **Listing Tasks**.

**Blocked by:** 02

**Status:** ready-for-agent

- [x] Through Seam 1, a "show tasks" message from a known User produces a processing-started event and then a result event listing that User's Tasks; no Note or Task is saved.
- [x] Only the sender's own Tasks are listed, never another User's.
- [x] Open Tasks come first (soonest due first, undated after), then done Tasks, each showing its Heading and due date and done ones marked as done.
- [x] With no Tasks saved, the reply says so plainly.
- [x] A list too long for one Channel message is cut and ends with how many more there are and a pointer to the dashboard.
- [x] A message that merely mentions tasks but is itself a to-do (e.g. "add a task to call the supplier") is still saved as a Task.
- [ ] Manually: typing "show tasks" to the bot on Telegram shows "processing…" edited into the Task list.

## Comments

- The glossary has no term yet for this request; it is deliberately not called a Query, which covers the Inventory only. Consider a term via `/domain-modeling` when implementing.
- Implemented. The core caps the list at 30 Tasks and reports how many more there are, so truncation is channel-neutral and tested at Seam 1. Date-only Tasks sort as due at 09:00 that day.
- "add a task to call the supplier" still becomes a Task: checked against the real model (nvidia/nemotron-3.5-super-vl:free), since the fake OpenRouter can't test prompt routing.
