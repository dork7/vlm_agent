# 39: Selection and List dialogs: guidance and empty states

**What to build:** Adding Tasks with an empty selection returns "Tick at least one Task." and the List page button is disabled until a box is ticked. On the Tasks page the Create List and Add to List controls explain how to enable them, announce a live "N selected" count, stay focusable (`aria-disabled`), and the dialogs say how many Tasks are involved. The Person field explains that empty means Draft and a new name adds a Person. The Add to List dialog has Cancel, and with no Lists shows "No Lists yet. Create one first." instead of an empty select.

**Blocked by:** None

**Status:** needs-triage

**Severity:** High

**Source:** [ui-ux-review](../../task-assignment-refresh/reviews/ui-ux-review.md) H4 Add Tasks with nothing ticked says "A List holds at most 50 Tasks"; [ui-ux-review](../../task-assignment-refresh/reviews/ui-ux-review.md) M5 Create List and Add to List disabled with no explanation; [ui-ux-review](../../task-assignment-refresh/reviews/ui-ux-review.md) M6 Person field gives no hint; [ui-ux-review](../../task-assignment-refresh/reviews/ui-ux-review.md) M7 Add to List dialog has no Cancel and an empty select

**Acceptance criteria:**

- [ ] An empty add returns the "Tick at least one Task." message, not the 50-Task error.
- [ ] Selected-count status is exposed and updates.
- [ ] Add to List has Cancel and handles zero Lists.
- [ ] Create List dialog shows the Person and count hints.
- [ ] Covered by tests through the existing HTTP workflow test seam.
