# Spec: Task board on a single page

Status: ready-for-agent

Builds on [../task-assignment-refresh/spec.md](../task-assignment-refresh/spec.md) and ADR 0006. Vocabulary is from `GLOSSARY.md`: Owner, Assigned Task, Note, Deadline, List, Person, Assignee, Assignment, Additional Task, Removed Task, Board. Adds **Template** (see Implementation Decisions). "Group" is not a term; use **List**.

## Problem Statement

As an Owner, creating Tasks, grouping them into Lists and getting a List to someone is spread over several pages and steps: a Tasks page with checkboxes, a Lists sidebar, a separate List page, and a form that needs a Person's name before a link exists. Handing the same set of Tasks to a second person means rebuilding the List by hand, and a Task can only sit in one List, so it can't be reused.

## Solution

One page for the Owner. A row at the top creates Tasks, which appear in a main list of **Templates**. Next to it, a Lists panel holds Lists. Dragging a Template onto a List puts a copy in that List; the Template stays in the main list and can be dragged to other Lists. Each List has a "Create & copy link" button that makes the Assignment link with no name needed and copies it. The recipient opens it anonymously, types their name once, and appears by name on the Board. "Duplicate List" makes a new List with fresh copies of the same Tasks and its own link, to hand to another person.

## User Stories

1. As an Owner, I want to create a Task from a row at the top of the page, so that I don't leave the page to add work.
2. As an Owner, I want newly created Tasks to appear in a main list straight away, so that I can see what I have to hand out.
3. As an Owner, I want Tasks in the main list to be reusable Templates that never get a status, so that I can hand the same Task to many people.
4. As an Owner, I want to create a List on the same page, so that I don't open another page to group Tasks.
5. As an Owner, I want to name a List when I create it, so that I can tell Lists apart.
6. As an Owner, I want to drag a Template onto a List, so that adding Tasks is one gesture.
7. As an Owner, I want the Template to stay in the main list after I drag it, so that I can drag it to another List.
8. As an Owner, I want each List to hold its own copy of a Task with its own status, Note and Deadline, so that two people's progress never collides.
9. As an Owner, I want editing or deleting a Template to leave existing copies unchanged, so that work already handed out is never altered under someone.
10. As an Owner, I want to drag a copy out of a List to remove it, so that I can take a Task back without a separate screen.
11. As an Owner, I want removing a copy to leave its Template alone, so that I can hand it out again.
12. As an Owner, I want a "Create & copy link" button on each List, so that I get a shareable link in one click.
13. As an Owner, I want to create the link without typing a Person's name, so that I can paste it into a message before I know who will open it.
14. As an Owner, I want the button to only copy the existing link on later clicks, so that I never silently kill a link I already sent.
15. As an Owner, I want the button to read "Copy link" once a link exists, so that I know a click won't create a new one.
16. As an Owner, I want replacing a link to stay a separate Reassign action, so that invalidating a link is always deliberate.
17. As an Owner, I want a "Duplicate List" button, so that I can give the same Tasks to another person.
18. As an Owner, I want a duplicate named "<name> (copy)", so that I can tell it from the original.
19. As an Owner, I want a duplicate's Tasks to start open with no Notes, so that nothing carries over from the first person.
20. As an Owner, I want a duplicate to have a new unassigned link and no Assignee, so that I can share it with someone new.
21. As an Owner, I want to drag a Template into a List that already has an Assignee, so that I can add work later.
22. As an Owner, I want such a Task to appear to the Assignee immediately as an Additional Task, so that they notice it.
23. As an Owner, I want a checkbox "Add to List" fallback, so that I can do everything without dragging on touch devices or with a keyboard.
24. As an Owner, I want the Board to show "Awaiting name" for a link nobody has opened yet, so that I know it hasn't been used.
25. As an Owner, I want the Board to show the Person's name once the recipient enters it, so that I can see who is doing what.
26. As an Owner, I want to rename or revoke a link, so that I keep control after sharing.
27. As an Owner, I want deleting a List to revoke its link and delete its copies, so that nothing is left dangling.
28. As an Owner, I want deleting a List to leave Templates untouched, so that I can reuse them.
29. As an Owner with existing Tasks, I want them to keep working after the upgrade, so that nothing is lost or moved.
30. As an Assignee, I want to open the link with no account, so that I can start immediately.
31. As an Assignee, I want to type my name once on first open, so that the Owner knows who I am.
32. As an Assignee, I want to not be asked for my name again on later visits, so that opening the link is quick.
33. As an Assignee, I want a revoked or replaced link to say so, so that I know why it stopped working.
34. As an Assignee, I want Tasks added later to show as Additional Tasks, so that I can tell new work from the original.
35. As an Assignee, I want Tasks removed from my List to show as Removed Tasks, so that they don't just vanish.
36. As an Assignee, I want my status and Note changes on my copies to stay on my List only, so that they never affect other people's copies.

## Implementation Decisions

- **Term:** a **Template** is a Task in the main list. It is never assigned and has no status. A **copy** is a Task that belongs to one List. "A Task is in at most one List" is replaced by "a copy is in exactly one List; a Template is in none". Update `GLOSSARY.md` and add ADR 0007, "Task templates and per-List copies", superseding the old rule. Note in the ADR that "Group" is not a term.
- **Schema:** Tasks gain a `kind` of `template` or `copy`. Copies record the Template they came from for display only; there is no live link between them. Backfill on upgrade: Tasks already in a List become `copy`, unlisted Tasks become `template`. No data is moved or deleted.
- **Copy on drag:** adding a Template to a List creates a copy carrying title, tags, instruction and Deadline, with status open and no Note. The Template is unchanged. Dragging a copy out removes it as a Removed Task. The existing "Add to List" request is the single entry point; drag and the checkbox fallback both call it.
- **Live lists:** adding to a List with an active link emits the existing added-Task event so it shows as an Additional Task; removal emits the existing removed-Task event. No new live mechanism.
- **Assignment without a Person:** an Assignment can exist with no Person yet. "Create & copy link" creates it once, idempotently, and returns the existing link on later calls. Reassign (replace) stays separate.
- **First open:** an unassigned Assignment's page asks for a name once, creates the Person and binds it to the Assignment. Afterwards the link behaves as an Assignee link does today; the link remains the only credential. The Board shows "Awaiting name", then the name.
- **Duplicate List:** creates "<name> (copy)" with fresh copies of its Tasks (status open, Notes cleared), a new unassigned Assignment, and no Person.
- **Delete List:** revokes the link and soft-deletes the List and its copies (see Retention), leaving Templates untouched.
- **Retention for analytics:** nothing is hard-deleted. Deleting a Template, removing a copy, deleting a List and deleting a Person set `deletedAt` (and a reason: `removed`, `template-deleted`, `list-deleted`, `person-deleted`) and hide the row from every Owner and Assignee view, count and the Board. The row keeps its status, Note, Deadline, timestamps and Assignee name. Done copies are kept permanently, record when they were completed (`doneAt`), and are never purged by housekeeping. This replaces the current hard deletes of Tasks, Lists and People.
- **Template edits:** editing or deleting a Template never changes copies.
- **UI:** one server-rendered page with an inline create row, the main list, and a Lists panel. It replaces the separate Tasks page, Lists sidebar and List page. Drag and drop uses native HTML5 drag events in vanilla JS, with no new dependency. The checkbox "Add to List" flow stays as the touch and keyboard fallback.

## Testing Decisions

- Good tests assert external behaviour only: responses, rendered HTML and events on the Owner and Assignee streams. They never inspect internals or the drag wiring.
- **Primary seam: the HTTP workflow seam**, as in the existing assignment workflow tests. Cover: create Template; copy into List (Template remains, copy independent); copy into several Lists; edit/delete Template leaves copies; remove copy leaves Template; add to a List with a live link emits the Additional Task event to the right streams only; Create & copy link is idempotent and needs no name; first-open name entry creates the Person and the Board shows it; a second open does not ask again; Duplicate List (name, fresh copies, open status, cleared Notes, new unassigned link); Delete List (link revoked, copies gone, Templates kept).
- **Secondary seam: store migration**, one test for the `kind` backfill, using the existing assignment test setup.
- **Prior art:** the existing assignment workflow tests, including Removed Task rows and live added-Task events reaching only the right Owner and Assignee streams.
- Deleted and Done rows are retained: after each delete or removal the row still exists with `deletedAt` and its reason, but no page, count or stream shows it; Done copies survive housekeeping.
- Drag-and-drop in the browser is a manual check; it only triggers the same request the fallback sends.

## Out of Scope

- Any analytics screen, export or report. This spec only guarantees the data is retained.
- Restoring a soft-deleted row from the UI.
- Reordering Tasks within a List.
- Choosing a subset of a List when opening a link.
- Sharing one link between several people.
- Live syncing of Template edits into copies.
- A drag-and-drop library; revisit SortableJS only if touch support proves unacceptable.
- Any change to the bot's Note, Task and User vocabulary or data.

## Design decision

Prototype Variant F (select-and-share, side by side) won over A (split panes), B (kanban), C (list + dock), D (kid-simple) and E (single column). Changes from the prototype: delete uses a confirm dialog instead of an undo bar, because a revoked link cannot be undone; the prototype's inline rename became part of the spec (stories 37-39).

Additional user stories:

37. As an Owner, I want to rename a List by clicking a pencil or double-clicking its name, so that I can fix names without leaving the page.
38. As an Owner, I want a duplicated List to open with its name ready to edit, so that I can replace "(copy)" straight away.
39. As an Owner, I want an empty rename to keep the old name, so that I never end up with a nameless List.
40. As an Owner on a phone, I want to tick Tasks and press one button to create a List and copy its link, so that I don't need drag-and-drop.
41. As an Owner, I want deleted Tasks, removed copies and deleted Lists to be kept out of sight but not erased, so that completion and workload can be analysed later.
42. As an Owner, I want every Done Task kept permanently with when it was completed, so that history stays accurate.
43. As an Owner, I want a deleted Person's past Tasks to keep that Person's name, so that history doesn't lose who did the work.

## Further Notes

- Implementation tickets: `issues/01` to `09`.
- Worklog: `docs/worklog/task-board-single-page.md`.
