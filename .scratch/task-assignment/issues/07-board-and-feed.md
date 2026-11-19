# 07: The Board and activity feed

**What to build:** The Board at `/assign`: one section per Person with their Lists, progress ("3 of 5 done"), **Not opened** or **Viewed 10 min ago**, and blocked Tasks highlighted with the reason; a section for unassigned Tasks and draft Lists; filters by Person, tag and status. An activity feed of the last 200 events (who, what, when), an unread badge from `lastSeenEventId` that clears when the feed is opened, and one "list complete" event when a List's last Task is done. See spec stories 15–18.

**Blocked by:** 06

**Status:** ready-for-agent

- [ ] Each Person's section lists their active Lists with the right progress and viewed state.
- [ ] Blocked Tasks show their reason; unassigned Tasks and draft Lists have their own section.
- [ ] Filtering by Person, tag or status shows only matching Lists and Tasks.
- [ ] The feed shows at most 200 entries; the badge counts events since the owner last opened it, and opening it clears the badge.
- [ ] Finishing a List's last Task adds exactly one "list complete" entry, and reopening and finishing again adds another.
- [ ] Times are shown in the browser's local time with relative wording.
