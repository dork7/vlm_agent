# 04: Create and copy a link with no Person; name entered on first open

**What to build:** An **Assignment** can exist with no Person. "Create & copy link" on a List creates the unassigned Assignment once and returns its link; later presses return the same link (the label becomes "Copy link"). Replacing a link stays the separate Reassign action. The first time someone opens the link they type a name once; that creates the **Person** and binds it to the Assignment. After that the link behaves like today's Assignee link and anyone with it acts as that Person. The Board shows "Awaiting name", then the Person's name. Revoked and replaced messages still show. Spec stories 12–16, 24–26, 30–33.

**Blocked by:** 01

**Status:** ready-for-agent

- [ ] Creating a link needs no name; pressing again returns the same link and creates nothing new.
- [ ] A first visit asks for a name; a later visit, on the same or another device, does not.
- [ ] Board shows "Awaiting name" before and the Person's name after.
- [ ] Reassign still replaces the link and the old one shows "replaced".
- [ ] Covered by tests through the HTTP workflow test seam.
