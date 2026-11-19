# 11: Status changes need a precondition and cleaner feed values

**What to build:** A status change applies only if the Task is still in the status it was validated against; a concurrent change returns "Invalid status transition" instead of overwriting, so the transition matrix cannot be violated and one click records one `task.status` event. The feed value includes the Note only for Blocked, not stale Notes on Done or Open. Blocked does not clobber a Note saved meanwhile by the other party without the user seeing it.

**Blocked by:** None

**Status:** needs-triage

**Severity:** Low

**Source:** [code-review](../../task-assignment-refresh/reviews/code-review.md) F9 Status change is a read-modify-write with no precondition (Confirmed by reading)

**Acceptance criteria:**

- [ ] Two concurrent status POSTs from Open: one succeeds, one is rejected with no second event.
- [ ] Done and Blocked requests racing from Open cannot both apply.
- [ ] `task.status` feed text for Done and Open carries no old Note.
- [ ] Covered by tests through the existing HTTP workflow test seam.
