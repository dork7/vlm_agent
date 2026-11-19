# 46: Settings layout and theme CSS clean-up

**What to build:** Settings renders through `page()` with the sidebar shell and a content gutter. The theme toggle no longer covers the last buttons on phones or becomes an early tab stop. Dialog height uses `100dvh`; duplicate `dialog` rules and unused CSS (`.metric*`, `.status-pill`, `.assignee-task*`, `.split-layout`) are removed. The unused `board.ejs` stub is removed if the constants ticket has not already.

**Blocked by:** 30

**Status:** needs-triage

**Severity:** Low

**Source:** [ui-ux-review](../../task-assignment-refresh/reviews/ui-ux-review.md) L12 Theme toggle placement; [ui-ux-review](../../task-assignment-refresh/reviews/ui-ux-review.md) L13 `100vh` dialog height and dead CSS; [ui-ux-review](../../task-assignment-refresh/reviews/ui-ux-review.md) L14 Settings uses the legacy layout; `board.ejs` stub

**Acceptance criteria:**

- [ ] Settings looks like the other pages and has a gutter on narrow screens.
- [ ] The toggle never overlaps interactive content at 320px.
- [ ] Unused rules are deleted.
- [ ] Checked visually in both themes.
