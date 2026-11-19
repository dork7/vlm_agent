# 31: Move inline scripts into real JS files

**What to build:** `liveScript`, `pageScript`, the `task-view` script and the script inside `theme.ejs` become `.js` files served from `'self'` (or raw-included), with inline `onclick` handlers replaced by delegated `data-` handlers. `task-view.ejs` is renamed and `theme.ejs` is split into CSS and script. The existing tests and no-JS behaviour are preserved.

**Blocked by:** 28

**Status:** needs-triage

**Severity:** Low

**Source:** [code-smells](../../task-assignment-refresh/reviews/code-smells.md) Finding 3 Inline scripts; [security-review](../../task-assignment-refresh/reviews/security-review.md) F5 note: inline scripts and handlers block a strict CSP

**Acceptance criteria:**

- [ ] No inline `<script>` bodies or `onclick` attributes remain in assign views.
- [ ] Scripts load from same-origin URLs.
- [ ] Live reload, time formatting, view toggle and dialog behaviour work as before.
- [ ] Covered by tests through the existing HTTP workflow test seam.
