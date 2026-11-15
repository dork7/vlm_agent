# 05: People, assigning and the link page

**What to build:** Assign a List to a Person by name (reusing a Person whose name matches, ignoring case), creating an Assignment with an unguessable code and a `/l/<code>` link with a copy button. The link page needs no login and shows the List, who it's for, and its Tasks with tags, instruction, note, blocked reason and status, done ones folded under "Done (n)". The assignee can mark Tasks done, blocked (with a reason) or open, and add a note — nothing else. Reassign makes a new link and kills the old; revoke kills it. See spec stories 10, 11, 13, 14.

**Blocked by:** 04

**Status:** ready-for-agent

- [ ] Codes come from a secure random source, are at least 8 characters, unique, and never written to the logs.
- [ ] "Sara" and "sara" are the same Person.
- [ ] The link page shows only that List's Tasks, with `noindex` in a header and a meta tag, and no cookies.
- [ ] The assignee can change status and the note only; anything else (titles, tags, instructions, other Tasks, adding Tasks) is refused.
- [ ] After a reassign or revoke the old link shows "no longer available" and accepts no changes; Task statuses carry over to the new link.
- [ ] Link pages are limited to 60 requests per minute per IP.
- [ ] Assignee changes are in `ta_events`, attributed to the Person.
