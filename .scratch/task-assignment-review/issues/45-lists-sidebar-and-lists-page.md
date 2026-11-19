# 45: Lists sidebar and Lists page

**What to build:** Sidebar progress is labelled ("2 of 5 done"). Under 48rem the Lists sidebar is a collapsed `<details>` with a capped height. The Lists page create form offers the same Person field and shows progress and a Removed/completed hint, or reuses the dialog, so there is one create flow.

**Blocked by:** 39

**Status:** needs-triage

**Severity:** Low

**Source:** [ui-ux-review](../../task-assignment-refresh/reviews/ui-ux-review.md) L1 Progress read as a fraction; [ui-ux-review](../../task-assignment-refresh/reviews/ui-ux-review.md) L2 Sidebar pushes Tasks down on phones; [ui-ux-review](../../task-assignment-refresh/reviews/ui-ux-review.md) L15 Lists page create flow differs from the dialog

**Acceptance criteria:**

- [ ] Progress has an accessible text label.
- [ ] On narrow viewports Tasks are not pushed below a long Lists block.
- [ ] The Lists page and the dialog create Lists the same way.
- [ ] Covered by tests through the existing HTTP workflow test seam.
