# Task templates and per-List copies

Supersedes the rule "an Assigned Task is in at most one List at a time" (see ADR 0006 and the earlier task-assignment-refresh spec).

Tasks now have a `kind`. A **Template** is a Task in no List; it is never assigned and has no status of its own to hand out. A **copy** is a Task that belongs to exactly one List and carries its own status, Note and Deadline. Putting a Template into a List will create a copy; the Template stays available to put in other Lists. A copy only records where it came from for display; there is no live link, so editing or deleting a Template never changes copies.

The grouping term is **List**. "Group" is not a term.

On upgrade, Tasks already in a List become `copy` and unlisted Tasks become `template`; no data is moved or deleted, and running the backfill again changes nothing.
