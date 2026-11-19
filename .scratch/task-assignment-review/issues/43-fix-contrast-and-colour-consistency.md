# 43: Fix contrast and colour consistency

**What to build:** Form field borders reach 3:1 against their background (WCAG 1.4.11); the brand mark text reaches 4.5:1; Reopen and secondary button borders are raised. One colour per meaning: Blocked and Overdue use consistent colours across badge, button and date text, the duplicate `.deadline.overdue` rule is merged and the date inherits the overdue colour. The report computed ratios from tokens only; re-verify in the browser.

**Blocked by:** None

**Status:** needs-triage

**Severity:** Medium

**Source:** [ui-ux-review](../../task-assignment-refresh/reviews/ui-ux-review.md) M12 Contrast failures (field borders, brand mark, Reopen button, secondary button); [ui-ux-review](../../task-assignment-refresh/reviews/ui-ux-review.md) L4 Blocked and Overdue colours inconsistent

**Acceptance criteria:**

- [ ] Computed ratios meet 3:1 for field borders and 4.5:1 for brand mark text in light and dark.
- [ ] Overdue and Blocked each use a single colour across badge and text.
- [ ] No behaviour change; checked visually in both themes.
