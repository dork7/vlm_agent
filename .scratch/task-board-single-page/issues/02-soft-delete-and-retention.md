# 02: Soft delete and retention for analytics

**What to build:** Nothing in the assignment module is hard-deleted any more. Deleting a Task, a List or a Person sets `deletedAt` and a `deleteReason` (`removed`, `template-deleted`, `list-deleted`, `person-deleted`) and hides the row from every Owner and Assignee page, count, Board entry and live stream. The row keeps its status, Note, Deadline, timestamps and Assignee name. Marking a copy Done records `doneAt`. Housekeeping never purges Tasks, Lists or People, so Done Tasks are kept permanently. A deleted Person's past Tasks keep the Person's name. No analytics screen or restore is included. Spec stories 41, 42, 43.

**Blocked by:** None (can start immediately)

**Status:** resolved

- [ ] Deleting a Task, List or Person leaves the row in the database with `deletedAt` and the right reason, and it disappears from every page, count, Board entry and live stream.
- [ ] Marking a copy Done records `doneAt`; Done copies survive housekeeping.
- [ ] A deleted Person's past Tasks still carry the Person's name.
- [ ] Existing delete routes and their tests still pass, now against soft deletes.
- [ ] Covered by tests through the existing HTTP workflow test seam.
