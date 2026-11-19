# 12: Notes near the 2000-character limit must not block status changes

**What to build:** A Task whose Note is long (including one produced by the legacy `blockedReason` + Note migration, or one with line breaks that browsers submit as CRLF) can still be marked Done, Open or Blocked. The length check applies only when the status is Blocked and the Note changed, newlines are normalised before measuring, and the migration trims to the limit. The migration also ignores `blockedReason` on Tasks that are no longer Blocked (reported as Possible).

**Blocked by:** None

**Status:** needs-triage

**Severity:** Low

**Source:** [code-review](../../task-assignment-refresh/reviews/code-review.md) F10 Notes over 2000 characters make status changes fail (migration and CRLF) (Possible)

**Acceptance criteria:**

- [ ] A status POST with an unchanged Note over 2000 characters succeeds for Done and Open.
- [ ] A Note near the limit with CRLF line breaks is measured after normalising newlines.
- [ ] Migration output never exceeds the limit; a legacy `null` or non-blocked `blockedReason` is handled.
- [ ] Covered by tests through the existing HTTP workflow test seam.
