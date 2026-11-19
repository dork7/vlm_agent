# 05: Single-page board, side by side (prototype Variant F)

**What to build:** Replace the separate Tasks page, Lists sidebar and List page with one page laid out as prototype Variant F (`?variant=F` on the Tasks page; code in the throwaway `prototype-board` module, which this ticket removes). **Left column:** a quick-add input (type and press Enter), then the Templates list, each row with a checkbox and an "in N lists" label. **Right column:** the Lists panel, sticky while the left scrolls; each List is an expandable row showing name, status pill (Not shared / Awaiting name / the Person's name), progress bar, task count, and when expanded its copies with done checkboxes and a remove (✕) control. Below 900px it stacks into one column. On touch and narrow screens: tap targets at least 44px, inputs 16px, and a one-line hint ("tick tasks, then tap Create list & copy link; dragging works on desktop"). Old List-page and sidebar URLs redirect to the new page. Spec stories 1–5, 23–25.

**Blocked by:** 03

**Status:** resolved

- [ ] Quick-add creates a Template that appears in the list straight away.
- [ ] Lists panel shows each List with pill, progress, count and expandable copies.
- [ ] Old Tasks, Lists and List-page URLs land on the new page.
- [ ] Layout stacks below 900px with no sideways scroll; touch targets and hint as described.
- [ ] The prototype module and its hooks are gone.
- [ ] Covered by tests through the HTTP workflow seam (rendered HTML and redirects); the layout is checked manually at desktop and 390px.
