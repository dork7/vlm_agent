# 02: Status buttons and collapsed Tasks

**What to build:** Replace the status dropdown and "Save status" with buttons on both the Owner's Task list/page and the Assignee's link page. Open Tasks offer **Blocked** and **Done**; Blocked Tasks offer **Done** and **Reopen**; Done Tasks offer **Reopen**. Reopen makes the Task open again and clears a List's completed state. Clicking Blocked reveals the Note field inline and submits from there. Tasks are collapsed by default: the Assignee sees title and buttons; the Owner sees checkbox, title, status badge and buttons. Expanding reveals instruction, tags, Deadline and Note. A Done Task keeps Reopen visible while collapsed. Spec stories 35–40, 45–49.

**Blocked by:** 01

**Status:** ready-for-agent

- [ ] Each status shows exactly the buttons above, on both pages.
- [ ] Done then Reopen restores an open Task in one click, collapsed or expanded.
- [ ] Collapsed by default; expansion is a keyboard- and screen-reader-friendly disclosure.
- [ ] Buttons work as plain form posts; only the inline Note reveal needs script.
- [ ] Covered by tests through the existing HTTP workflow test seam.
