# 04: Double-submitted Remove or Delete Task must be idempotent

**What to build:** Removing a Task from a List (or deleting a Task) twice in parallel changes state exactly once: `taskCount` drops by one, one Removed row is written, one "Task removed" event and banner reaches the Assignee, and the 50-Task cap stays correct. Delete Task racing Remove behaves the same, using the document actually removed rather than a stale read. The Removed row is written as a single consistent update, and `addedToListAt` is cleared on removal. Removing a Task that is in no List or is already removed is a clean no-op.

**Blocked by:** None

**Status:** needs-triage

**Severity:** Medium

**Source:** [code-review](../../task-assignment-refresh/reviews/code-review.md) F2 Concurrent/double Remove double-decrements taskCount and duplicates Removed rows (Confirmed); [code-review](../../task-assignment-refresh/reviews/code-review.md) F8 second bullet: stale `addedToListAt` is never cleared on remove/delete (Possible)

**Acceptance criteria:**

- [ ] Two parallel Removes of one Task leave `taskCount` down by 1 and exactly one Removed row.
- [ ] Remove racing Delete Task, and Delete racing Delete, leave counts and Removed rows consistent.
- [ ] The 50-Task cap cannot be exceeded after a double-submitted Remove.
- [ ] Removing a Task not in the List (or already removed) writes nothing and shows no duplicate event.
- [ ] Covered by tests through the existing HTTP workflow test seam.
