# 01: Double-submitted add Tasks must not detach Tasks or corrupt the List

**What to build:** Adding Tasks to an existing List stays correct when the same add is submitted twice (double click, two tabs, retry). Exactly one submission wins; the loser fails cleanly without detaching anything the winner attached, `taskCount` always equals the Tasks actually in the List, and no `list.add` event is emitted for Tasks that are not in the List. Re-adding a previously Removed Task never leaves both a live Task and its Removed row, even if a step fails part-way. The Additional task decision cannot be lost when the List is first assigned during the add, and adding an already-Done Task to an otherwise all-Done List re-evaluates completion. The rollback `$inc` is scoped by Owner.

F7/F8 are marked Likely/Possible in the report; confirm by test before choosing the fix (per-Task attach, attach token, or compensation order; ADR 0006 avoids replica-set transactions).

**Blocked by:** None

**Status:** needs-triage

**Severity:** High

**Source:** [code-review](../../task-assignment-refresh/reviews/code-review.md) F1 Concurrent/double add Tasks rolls back the other request's attachments (Confirmed); [code-review](../../task-assignment-refresh/reviews/code-review.md) F7 Removed row cleared after attach, non-atomically (Likely); [code-review](../../task-assignment-refresh/reviews/code-review.md) F8 Additional Task decision uses a stale List snapshot (Possible); [code-review](../../task-assignment-refresh/reviews/code-review.md) F12 bullet: adding an already-Done Task to a completed List does not re-sync completion

**Acceptance criteria:**

- [ ] Two parallel `POST /assign/lists/:id/add` with the same Tasks leave `taskCount` equal to the number of Tasks in the List and no Task silently detached.
- [ ] Only the winning request emits `list.add` events and feed entries.
- [ ] Re-adding a Removed Task during a failed or raced add never leaves a Removed row beside the live Task.
- [ ] A Task added while the List is first being assigned still carries the Additional task tag (or the race is shown not to exist).
- [ ] Adding an already-Done Task to a completed List leaves completion state consistent.
- [ ] Covered by tests through the existing HTTP workflow test seam.
