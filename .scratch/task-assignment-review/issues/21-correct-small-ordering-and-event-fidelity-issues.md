# 21: Correct small ordering and event-fidelity issues in List and Task writes

**What to build:** `POST /assign/lists` validates the Person name before attaching Tasks and records `list.create` before `assignment.create`. The `task.edit` event includes the Deadline in its from/to values. A failure while recording an event does not report 500 for a change that persisted (decide: log and continue, or write in the other order). Board filters (`tag`, `person`, `status`) given as arrays use the first value rather than silently matching nothing.

Not ticketed: Overdue is computed at render time only, which the spec explicitly requires; stale Assignee posts returning 200 matches spec story 63.

**Blocked by:** None

**Status:** needs-triage

**Severity:** Low

**Source:** [code-review](../../task-assignment-refresh/reviews/code-review.md) F12 bullets: `POST /assign/lists` validation order and event order; `recordEvent` failure after write; `task.edit` event omits Deadline; board query params as arrays

**Acceptance criteria:**

- [ ] A too-long Person name on create-List fails before any Task is attached.
- [ ] Feed order shows `list.create` before `assignment.create`.
- [ ] Editing only a Deadline produces a feed entry that shows the Deadline change.
- [ ] `?tag=a&tag=b` does not return an empty Board.
- [ ] Covered by tests through the existing HTTP workflow test seam.
