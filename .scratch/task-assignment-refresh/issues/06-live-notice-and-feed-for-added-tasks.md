# 06: Live notice and Board feed for added Tasks

**What to build:** When the Owner adds a Task to an assigned List, an Assignee's open link page shows a live banner "New Task added: <title>", and the Owner's Board feed records "Added <Task> to <List>". Adding to a Draft List notifies nobody. Delivery uses the existing live event stream and event store; no email or other out-of-band notification, since a Person has only a name. Spec stories 26, 31, 32.

**Blocked by:** 05

**Status:** ready-for-agent

- [ ] An open Assignee page gets the banner for an added Task without refreshing.
- [ ] Board feed has an entry for each add to an assigned List, and none for Draft Lists.
- [ ] The event is stored before it is broadcast, and reaches only the right Owner and Assignment streams.
- [ ] Covered by tests through the existing HTTP workflow test seam.
