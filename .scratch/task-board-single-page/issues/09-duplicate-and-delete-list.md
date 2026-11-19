# 09: Duplicate List and Delete List

**What to build:** **Duplicate List** creates "<name> (copy)" with fresh copies of its Tasks (status open, Notes cleared), a new unassigned link (ticket 04) and no Person, then opens it with its name in rename mode (ticket 08) so "(copy)" can be replaced straight away. **Delete List** revokes its link and soft-deletes the List and its copies (reason `list-deleted`, ticket 02; status, Notes, Assignee name and timestamps kept for analytics, nothing shown), leaving Templates untouched. The prototype used an undo bar; a revoked link cannot be undone, so Delete asks for confirmation using the existing confirm dialog and says what will happen. Spec stories 17–20, 27, 28, 38.

**Blocked by:** 02, 04, 08

**Status:** ready-for-agent

- [ ] Duplicate gives a new List with fresh copies, a new unassigned link, no Person, cleared Notes and open status; the original is unchanged.
- [ ] Delete asks for confirmation naming the active link and the copies that go.
- [ ] After Delete the old link shows "revoked" and the List and its copies disappear from every view and count; Templates remain.
- [ ] The deleted List, its copies and their Done history remain in the database with `deletedAt` and `list-deleted`.
- [ ] Covered by tests through the HTTP workflow test seam.
