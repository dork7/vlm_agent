# 03: Add to List copies a Template, with live events

**What to build:** Adding Tasks to a List (the existing Add to List and Create List requests) creates an independent **copy** of each Template: title, tags, instruction and Deadline carried over, status open, no Note. The Template stays in the main list and can go into other Lists. Removing a copy produces a **Removed Task** row as today and soft-deletes the copy (reason `removed`, ticket 02), leaving its Template alone. Editing a Template never changes copies; deleting a Template soft-deletes only the Template. Adding to a List with an active link shows the copy to the Assignee immediately as an **Additional Task**, using the existing added-Task and removed-Task events and streams. Spec stories 3, 7–11, 21, 22, 34–36.

**Blocked by:** 01, 02

**Status:** ready-for-agent

- [ ] Adding a Template to two Lists gives two independent copies; changing status or Note on one touches neither the other nor the Template.
- [ ] The Template stays in the main list after being added; removing a copy leaves it in place.
- [ ] Editing a Template leaves copies unchanged; deleting one leaves them untouched and retains the Template row.
- [ ] A removed copy is retained and hidden from every view and count.
- [ ] Adding to a List with a live link emits the Additional Task event to that List's Owner and Assignee streams only.
- [ ] Covered by tests through the existing HTTP workflow test seam.
