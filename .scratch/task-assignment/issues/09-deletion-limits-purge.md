# 09: Deletion rules and housekeeping

**What to build:** Deleting with stated effects: a List revokes its active link and returns its Tasks to the pool (statuses kept); a Person revokes all their active Assignments, keeping views and events as history; a Task in an active List disappears from the assignee page at once. The confirmation names the effect ("revokes 2 active links"). A daily in-process purge deletes views older than 90 days and expired login and refresh tokens. See spec story 12 and **Housekeeping**.

**Blocked by:** 08

**Status:** ready-for-agent

- [ ] Each delete's confirmation names what it will revoke or return, and the delete does exactly that.
- [ ] After deleting a List or Person, their old links show "no longer available", and open link pages are told live.
- [ ] Deleting a Task removes it from an open link page live.
- [ ] The purge removes views older than the retention days and expired tokens, keeps everything newer, and running it twice changes nothing more.
