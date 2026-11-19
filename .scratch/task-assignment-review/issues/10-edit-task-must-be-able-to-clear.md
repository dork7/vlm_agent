# 10: Edit Task must be able to clear a Deadline

**What to build:** An Owner can remove a Task's Deadline from the edit form by clearing the date, whichever way the form is submitted. A time without a date means "no Deadline" on edit (or gives the specific message "Pick a date as well as a time"), and an explicit "Clear Deadline" control exists. Without JavaScript, saving another edit (for example the title) does not silently delete an existing Deadline.

**Blocked by:** None

**Status:** needs-triage

**Severity:** Medium

**Source:** [code-review](../../task-assignment-refresh/reviews/code-review.md) F4 Edit Task cannot clear a Deadline (Confirmed; no-JS silent clear is Low/Possible); [ui-ux-review](../../task-assignment-refresh/reviews/ui-ux-review.md) M9 Clearing only the Deadline date leaves the time filled and gives a generic error; [security-review](../../task-assignment-refresh/reviews/security-review.md) F15 bullet: editing with no deadline input silently unsets the Deadline

**Acceptance criteria:**

- [ ] Posting an edit with an empty date and a populated time clears the Deadline (or returns a field-specific message), not "Invalid Deadline.".
- [ ] An explicit Clear Deadline control removes the Deadline.
- [ ] Editing only the title with no deadline fields posted keeps the existing Deadline.
- [ ] The existing test that clears both fields still passes.
- [ ] Covered by tests through the existing HTTP workflow test seam.
