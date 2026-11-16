# 01: Merge blocked reason into Note

**What to build:** A Task has one optional **Note** (GLOSSARY: Note) that also says what is blocking it. The separate blocked-reason field and its "What's blocking it?" input disappear on both the Owner's Task page and the Assignee's link page. Blocking a Task no longer requires any text; the Note hint reads "Say what's blocking you here, if anything". A one-off, idempotent migration at deploy time folds each existing blocked reason into the Note ahead of the old Note, separated by a blank line (reason alone when there is no Note). Wherever the blocked reason was shown (Task link, Board, feed event text) the Note is shown instead. Spec stories 41–44.

**Blocked by:** None (can start immediately).

**Status:** ready-for-agent

- [ ] Blocking a Task with an empty Note succeeds, on both pages.
- [ ] Blocked Tasks show their Note on the Board, the feed and the Task link.
- [ ] Migration handles both set, reason only, note only, neither, and is safe to run twice.
- [ ] New Tasks have no blocked-reason field.
- [ ] Covered by tests through the existing HTTP workflow test seam.
