# 42: Live updates and dialogs must not discard the user's work

**What to build:** A live event does not reload while a `<dialog>` is open or any `<details>` is expanded; it shows the "Reload to see them" notice instead (ideally open state is preserved across reloads). Storage access is wrapped so live updates still start in private or blocked-storage browsers. A dialog closes on backdrop click only when the click is outside its bounding box, and a drag-select that ends on the padding does not close it.

**Blocked by:** 31

**Status:** needs-triage

**Severity:** Medium

**Source:** [ui-ux-review](../../task-assignment-refresh/reviews/ui-ux-review.md) M10 Live event does `location.reload()` and loses state; [ui-ux-review](../../task-assignment-refresh/reviews/ui-ux-review.md) M11 `sessionStorage` access not wrapped in try/catch; [ui-ux-review](../../task-assignment-refresh/reviews/ui-ux-review.md) M14 Dialog backdrop click closes and discards input

**Acceptance criteria:**

- [ ] Live event with an open dialog or expanded row shows the notice, not a reload.
- [ ] Script runs with storage throwing.
- [ ] A click on dialog padding does not close it.
- [ ] Browser-run verification noted in the ticket if not unit-testable.
