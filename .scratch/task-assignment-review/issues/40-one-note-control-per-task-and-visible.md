# 40: One Note control per Task and visible Assignee status

**What to build:** Each Task offers a single Note editor for the Assignee and for the Owner; Blocked focuses that one field (for example a "Mark Blocked" button expands details and focuses the Note) rather than a second textarea. The Assignee collapsed row shows a status badge, and the page headings read To do / Done / Removed. Copy is neutral ("What's blocking this? (optional)", "Mark Blocked") and "Assignee" is capitalised on the Task page.

**Blocked by:** 38

**Status:** needs-triage

**Severity:** Medium

**Source:** [ui-ux-review](../../task-assignment-refresh/reviews/ui-ux-review.md) M1 Two Note textareas per Task (stories 40-41); [ui-ux-review](../../task-assignment-refresh/reviews/ui-ux-review.md) M3 Assignee collapsed row shows no status; dead `.assignee-task.blocked` CSS; [ui-ux-review](../../task-assignment-refresh/reviews/ui-ux-review.md) L9 Owner copy and capitalisation

**Acceptance criteria:**

- [ ] No Task page or row contains two controls named Note.
- [ ] Assignee rows show Open/Blocked/Done status when collapsed.
- [ ] Copy uses the glossary terms.
- [ ] Covered by tests through the existing HTTP workflow test seam.
