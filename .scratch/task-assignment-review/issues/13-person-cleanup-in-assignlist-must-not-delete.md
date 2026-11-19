# 13: Person cleanup in assignList must not delete a Person another request attached

**What to build:** Two concurrent assigns of the same List to a brand-new name never leave an active Assignment pointing at a deleted Person. Cleanup deletes a Person only when no Assignment references it (or does not delete on failure at all), and restoring the previous Assignment cannot mask the original error with a duplicate-key error.

**Blocked by:** None

**Status:** needs-triage

**Severity:** Low

**Source:** [code-review](../../task-assignment-refresh/reviews/code-review.md) F6 `assignList` Person cleanup can delete a Person another request just attached (Likely; new in this branch)

**Acceptance criteria:**

- [ ] Two parallel assigns to a new name leave a valid Person and a working `/l/:code` for the winner.
- [ ] A failed assign does not throw a secondary duplicate-key error from the restore step.
- [ ] Covered by tests through the existing HTTP workflow test seam.
