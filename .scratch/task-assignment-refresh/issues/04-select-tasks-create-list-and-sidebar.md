# 04: Select Tasks, create and assign a List, Lists sidebar

**What to build:** Each Task row on the Tasks page has a checkbox (disabled and labelled with its List if already in one). With at least one ticked, **Create List** opens a dialog for the List name and an optional Person (existing, or a new name). With a Person it creates the List and its Assignment in one step and lands on the List page showing the link to copy; without, it creates a Draft. A sidebar lists every List with Draft or Assigned and its done count (such as 2/5), links to each List page, updates live, and collapses above the Tasks on narrow screens. Existing 50-Task cap and one-List rule stay. Spec stories 12–22.

**Blocked by:** 02

**Status:** ready-for-agent

- [ ] Create-and-assign is all or nothing; a failure leaves no List or Assignment behind.
- [ ] Tasks already in a List can't be selected, and the server rejects them anyway.
- [ ] Sidebar counts and statuses are correct and update live.
- [ ] Dialog and sidebar are keyboard and screen-reader usable, with focus returned after the dialog closes.
- [ ] Covered by tests through the existing HTTP workflow test seam.
