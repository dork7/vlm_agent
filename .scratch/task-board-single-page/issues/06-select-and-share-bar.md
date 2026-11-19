# 06: Select-and-share bar (create list and copy link in one click)

**What to build:** On the single page, ticking Templates shows an action bar: "N selected", an optional List name, **Create list & copy link**, an **Add to existing** dropdown and **Clear**. Create makes a List with copies of the ticked Templates, auto-named "List N" if the name is blank, creates its unassigned link (ticket 04), copies the link to the clipboard and opens the new List in the Lists panel. This checkbox flow is also the touch and keyboard fallback for dragging. On narrow screens the bar is fixed full-width at the bottom. Spec stories 6, 12, 13, 23, 40.

**Blocked by:** 04, 05

**Status:** resolved

- [ ] Create makes the List, its copies and its link in one request and copies the link.
- [ ] A blank name gets "List N"; a typed name is used.
- [ ] Add to existing adds copies to the chosen List, including one with a live link (Additional Task).
- [ ] The bar shows only while something is selected; Clear empties the selection.
- [ ] Covered by tests through the HTTP workflow seam; the bar's placement is checked manually at desktop and 390px.
