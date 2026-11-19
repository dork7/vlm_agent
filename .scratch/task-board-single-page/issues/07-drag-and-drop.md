# 07: Drag a Template onto a List, drag a copy out

**What to build:** Desktop drag-and-drop using native HTML5 drag events in vanilla JS, with no new dependency. Dragging a Template onto a List row adds a copy, sending the same request as the checkbox flow. If the dragged Template is ticked, all ticked Templates go together. Dragging a copy out of a List onto the Templates area removes it. Valid drop targets highlight while dragging. Touch devices keep using the checkbox flow. Spec stories 6, 7, 10, 11.

**Blocked by:** 03, 05

**Status:** ready-for-agent

- [ ] Dropping a Template on a List adds a copy; the Template stays.
- [ ] Dragging a ticked Template moves all ticked ones.
- [ ] Dragging a copy to Templates removes it as a Removed Task.
- [ ] No new dependency. Drops send the same requests as the checkbox flow, so the HTTP tests from tickets 03 and 06 cover behaviour; the drag wiring is checked manually.
