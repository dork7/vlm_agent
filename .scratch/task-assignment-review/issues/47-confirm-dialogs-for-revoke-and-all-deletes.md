# 47: Confirm dialogs for Revoke and all deletes

**What to build:** Revoke link, Reassign (which revokes silently), Delete Task and Delete Person use the same confirm-dialog pattern as Delete List, naming what will happen.

**Blocked by:** 38

**Status:** needs-triage

**Severity:** Low

**Source:** [ui-ux-review](../../task-assignment-refresh/reviews/ui-ux-review.md) L8 Revoke link is one click with no confirm; delete flows use separate pages

**Acceptance criteria:**

- [ ] Each destructive action asks for confirmation in a dialog before acting.
- [ ] No-JS behaviour still reaches a confirmation step.
- [ ] Covered by tests through the existing HTTP workflow test seam.
