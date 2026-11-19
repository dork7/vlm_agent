# 37: Status buttons keep the user's place and confirm the change

**What to build:** Marking a Task Done, Blocked or Open returns the Owner to the page they clicked from and the Assignee to `/l/:code`, scrolled to that Task (`#task-<id>`; each row has an id). A `role="status"` message such as "Marked Done: <title>" appears, with a Reopen link for Done. Only when the referrer is unusable does the Owner fall back to the Task detail page.

**Blocked by:** 11

**Status:** needs-triage

**Severity:** High

**Source:** [ui-ux-review](../../task-assignment-refresh/reviews/ui-ux-review.md) H1 Status POST always redirects away from the context it was clicked in, with no feedback (stories 35, 46, 48)

**Acceptance criteria:**

- [ ] Owner status change from the Tasks list returns to the Tasks list at the row.
- [ ] Assignee status change returns to the Assignee page anchored at the Task.
- [ ] A status message is announced after the change.
- [ ] Unusable referer falls back to the detail page.
- [ ] Covered by tests through the existing HTTP workflow test seam.
