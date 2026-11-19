# 44: Assignee page messages, time format and Removed rows

**What to build:** Deadlines render with the time zone name, and without JavaScript show a readable UTC fallback; the redundant tooltip is dropped. An unknown code says "This link isn't valid"; a replaced link says it was replaced by a newer one and to ask the sender for the latest link (without revealing List data). Removed rows say "Removed by the sender. Nothing to do." and are visually muted.

**Blocked by:** None

**Status:** needs-triage

**Severity:** Low

**Source:** [ui-ux-review](../../task-assignment-refresh/reviews/ui-ux-review.md) L5 Time format drops the zone and no-JS shows raw ISO; [ui-ux-review](../../task-assignment-refresh/reviews/ui-ux-review.md) L6 Revoked message shown for mistyped codes; replaced has no next step; [ui-ux-review](../../task-assignment-refresh/reviews/ui-ux-review.md) L7 Removed rows have no explanation

**Acceptance criteria:**

- [ ] Unknown, revoked and replaced codes show distinct messages with no Task detail.
- [ ] No-JS Deadline is human readable.
- [ ] Removed rows carry the explanatory sentence.
- [ ] Covered by tests through the existing HTTP workflow test seam.
