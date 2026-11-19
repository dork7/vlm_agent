# 22: Close remaining test gaps from the code review

**What to build:** Add the tests the review lists that are not owned by another ticket: Remove/Delete on a Task in no List; the migration with a non-blocked `blockedReason`, combined length over 2000, or legacy `null`; Overdue crossing the deadline using the injected clock; and view-toggle tests that run against the rendered page instead of hand-built HTML. Tests that only assert a marker string exists on a page that always contains it are tightened to the specific Task row. Concurrency, SSE and Deadline-clear tests belong to their own tickets.

**Blocked by:** None

**Status:** needs-triage

**Severity:** Low

**Source:** [code-review](../../task-assignment-refresh/reviews/code-review.md) Test gaps section (items not already covered by the bug tickets above)

**Note:** The review says it found no outright vacuous tests, only some that should be checked.

**Acceptance criteria:**

- [ ] Each gap listed above has a test that fails if the behaviour regresses.
- [ ] Marker-string assertions (for example `Additional task`) are scoped to the Task row.
- [ ] Overdue is asserted by advancing the injected clock across a Deadline.
- [ ] Covered by tests through the existing HTTP workflow test seam.
