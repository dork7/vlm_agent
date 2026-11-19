# 41: Validation errors keep the form and name the problem

**What to build:** Failed Add Task, Edit Task and Create List re-render the originating page or form with the entered values, `aria-invalid` and a field-level message naming the rule (5 tags, 30 characters per tag, 200/2000 characters). Limits are shown next to inputs. A failed Add Task re-opens the real dialog on the real Tasks page with focus on the error and first invalid field, with one alert instead of two and one shared dialog template. Error page titles are prefixed "Error: ".

**Blocked by:** 30

**Status:** needs-triage

**Severity:** Medium

**Source:** [ui-ux-review](../../task-assignment-refresh/reviews/ui-ux-review.md) M8 Generic error pages drop input on Edit and Create List; [ui-ux-review](../../task-assignment-refresh/reviews/ui-ux-review.md) M13 Add Task failure page is a separate, inconsistent dialog; [ui-ux-review](../../task-assignment-refresh/reviews/ui-ux-review.md) L16 first bullet: error pages reuse the page title

**Acceptance criteria:**

- [ ] A failed Edit or Create List keeps the typed values.
- [ ] Messages name the failing field and limit.
- [ ] Failed Add Task shows the normal dialog, one announced error, correct timezone offset recompute.
- [ ] Error titles start with "Error: ".
- [ ] Covered by tests through the existing HTTP workflow test seam.
