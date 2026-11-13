# 05: Add Tasks to an existing List, with the Additional Task tag

**What to build:** Two ways to add Tasks to an existing List: tick Tasks on the Tasks page and choose **Add to List** (the Create List dialog also offers existing Lists), or use **Add Tasks** on the List page to pick from Tasks in no List. A Task added after its List was **first** assigned is an **Additional Task** and carries a permanent "Additional task" tag for both Owner and Assignee, even after Done, and even across revoke and reassign to another Person. Tasks added before first assignment carry no tag. Adding to a List whose Tasks were all Done makes it not completed again. Spec stories 23–25, 27–30, 33, 34.

**Blocked by:** 04

**Status:** ready-for-agent

- [ ] Both entry points add Tasks and enforce the one-List rule.
- [ ] Tag appears only for Tasks added after first assignment and persists through Done, revoke and reassign.
- [ ] A completed List stops being completed on add.
- [ ] Covered by tests through the existing HTTP workflow test seam.
