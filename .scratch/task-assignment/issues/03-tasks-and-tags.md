# 03: Tasks and tags

**What to build:** The owner's Task pool: create a Task with a title (open, in no List), edit its title, tags and instruction, read, edit or clear its note, set its status (blocked needs a reason, cleared on leaving blocked), reopen and delete it. Filter the pool by tag. Every change writes an event to `ta_events`. See spec stories 5–7, 9.

**Blocked by:** 02

**Status:** ready-for-agent

- [ ] A new Task is open and in no List.
- [ ] Tags are trimmed and lowercased, at most 5 of up to 30 characters each, and reused across the owner's Tasks; the tag filter shows only matching Tasks.
- [ ] Blocked needs a reason, saved as the blocked reason and cleared when the Task leaves blocked.
- [ ] Titles over 200 characters and notes, instructions or reasons over 2,000 are refused; HTML in any of them is shown escaped.
- [ ] Each change (create, edit, status, note, delete) is in `ta_events` with what changed from and to.
- [ ] Another owner can't see, change or delete the Task, even with its ID (404).
