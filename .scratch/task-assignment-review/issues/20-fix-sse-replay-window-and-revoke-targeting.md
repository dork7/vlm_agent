# 20: Fix SSE replay window and revoke targeting

**What to build:** The reset threshold counts the Owner's own events after `Last-Event-ID` (more than 500), not the global sequence gap. An `assignment.revoke` event carries the Assignment id, and a stream closes only for its own Assignment, so an Assignee who opens a reassigned List's new link is not told "revoked".

**Blocked by:** None

**Status:** needs-triage

**Severity:** Low

**Source:** [code-review](../../task-assignment-refresh/reviews/code-review.md) F12 first two bullets: `latest.seq - last > 500` compares against the global counter; `assignment.revoke` can hit the new link's stream

**Acceptance criteria:**

- [ ] With another Owner's events inflating the global counter, a reconnect with a recent `Last-Event-ID` replays instead of resetting.
- [ ] A new link's stream is unaffected by the old link's `assignment.revoke`.
- [ ] Covered by tests through the existing HTTP workflow test seam.
