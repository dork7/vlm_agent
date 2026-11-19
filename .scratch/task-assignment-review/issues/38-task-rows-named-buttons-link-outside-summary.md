# 38: Task rows: named buttons, link outside summary, stable expand

**What to build:** Every row exposes per-Task accessible names ("Mark <title> done", "Block <title>", "Reopen <title>", and the same for Save buttons; each form grouped and labelled). The Owner title link sits outside `<summary>`; the summary is a short Details toggle named for the Task. Expanding a row keeps the summary in place and puts only the detail body in the full-width area. The checkbox uses an `aria-label` and the title is visible once. Each row `<article>` is labelled by its title.

**Blocked by:** None

**Status:** needs-triage

**Severity:** High

**Source:** [ui-ux-review](../../task-assignment-refresh/reviews/ui-ux-review.md) H2 Bare status buttons have no Task name; [ui-ux-review](../../task-assignment-refresh/reviews/ui-ux-review.md) H3 Interactive link inside `<summary>`; [ui-ux-review](../../task-assignment-refresh/reviews/ui-ux-review.md) M2 Expanding moves the summary; [ui-ux-review](../../task-assignment-refresh/reviews/ui-ux-review.md) M4 Duplicate title in checkbox label; [ui-ux-review](../../task-assignment-refresh/reviews/ui-ux-review.md) L16 second bullet: rows have no accessible name

**Acceptance criteria:**

- [ ] A screen-reader button list distinguishes buttons per Task.
- [ ] The title link is reachable and not inside `<summary>`.
- [ ] Opening details does not move the toggle or focus.
- [ ] The title appears once visibly per row; Task rows have an accessible name.
- [ ] Covered by tests through the existing HTTP workflow test seam.
