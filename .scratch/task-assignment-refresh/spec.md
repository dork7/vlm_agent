# Spec: Task assignment refresh

Status: ready-for-agent

Builds on [../task-assignment/spec.md](../task-assignment/spec.md) and ADR 0006 (separate module on MongoDB). Vocabulary is from `GLOSSARY.md`: Owner, Assigned Task, Note, Deadline, List, Person, Assignee, Assignment, Additional Task, Removed Task, Board. Implementation tickets: `issues/01` to `08`.

## Problem Statement

As an Owner, creating Tasks and getting them to someone takes too many steps. The Add Task form sits inline, I can't tick several Tasks and turn them into a List in one go, and I can't see my Lists while I work on Tasks. Changing a Task's status means picking from a dropdown and pressing Save, and a mis-click on Done is awkward to undo. "What's blocking it" and "Note" are two fields for what is really one thought. Every Task is fully expanded, so the page is noisy.

As an Assignee, I'm never told when the Owner adds a Task to a List I already have, I can't tell new work from the original work, and Tasks the Owner takes away just vanish. If my link is revoked I don't know why.

## Solution

Adding a Task is a popup, with an optional Deadline that defaults to end of day. The Tasks page has a sidebar of Lists, and Tasks can be ticked and turned into a List, optionally assigned to a Person in the same step, or added to an existing List. Status is changed with buttons: Blocked, Done and Reopen. A Task has one Note, which also says what's blocking it. Tasks are collapsed by default.

An Assignee whose List gains a Task sees a live banner and a permanent "Additional task" tag. A Task taken away stays visible as Removed with nothing to act on. A dead link says whether it was revoked or replaced.

## User Stories

### Adding Tasks
1. As an Owner, I want Add Task to open a popup, so that the Tasks page stays uncluttered.
2. As an Owner, I want the popup to keep Title, Tags and Instructions, so that nothing I used is lost.
3. As an Owner, I want to optionally set a Deadline date and time, so that the Assignee knows when it is due.
4. As an Owner, I want the time to default to the end of the day when I pick only a date, so that I don't have to type a time for "by tonight".
5. As an Owner, I want a Deadline I enter to mean my own time zone, so that "end of day" is mine.
6. As an Owner, I want to edit a Task's Deadline later, so that plans can change.
7. As an Owner, I want a validation error to reopen the popup with my input and the message, so that I don't retype.
8. As an Assignee, I want to see each Task's Deadline in my own time zone, so that I am not confused by someone else's clock.
9. As an Assignee, I want to be unable to change a Deadline, so that I can't move the goalposts.
10. As an Owner or Assignee, I want an overdue, not-done Task marked Overdue in colour and in text, so that late work is visible without relying on colour alone.
11. As an Owner or Assignee, I want a Done Task never marked Overdue, so that finished work isn't flagged.

### Lists from selected Tasks
12. As an Owner, I want a checkbox on each Task row, so that I can select several.
13. As an Owner, I want a Create List button once at least one Task is ticked, so that I can group them.
14. As an Owner, I want Tasks already in a List to be unselectable and labelled with their List, so that I understand the one-List rule.
15. As an Owner, I want Create List to ask for a name and optionally a Person (existing or new), so that I can group and hand over in one step.
16. As an Owner, I want to land on the new List's page with the link ready to copy when I chose a Person, so that I can send it straight away.
17. As an Owner, I want leaving the Person empty to create a Draft List, so that I can prepare without sending.
18. As an Owner, I want creation to be all or nothing, so that I never end up with a List but no Assignment after an error.
19. As an Owner, I want a sidebar listing every List with Draft or Assigned and a done count like 2/5, so that I see my Lists while working.
20. As an Owner, I want to open a List from the sidebar, so that I can manage it quickly.
21. As an Owner on a phone, I want the sidebar to collapse above the Tasks, so that the page still fits.
22. As an Owner, I want the sidebar to update live, so that it never shows stale progress.

### Adding to an existing List
23. As an Owner, I want to tick Tasks and choose Add to List, so that I can grow a List from the Tasks page.
24. As an Owner, I want an Add Tasks button on the List page showing Tasks that are in no List, so that I can grow it from there too.
25. As an Owner, I want a Task in another List to be unpickable, so that the one-List rule holds.
26. As an Assignee, I want a live banner "New Task added: <title>" if my page is open, so that I notice straight away.
27. As an Assignee, I want a permanent "Additional task" tag on Tasks added after my List was first assigned, so that I can tell new work from original work.
28. As an Owner, I want to see the same tag, so that I know what the Assignee sees.
29. As an Owner, I want Tasks added before assignment to carry no tag, so that preparing a List doesn't clutter it.
30. As an Owner, I want the tag to survive a revoke and reassign, including to a different Person, so that "additional" always means "added after first assignment".
31. As an Owner, I want adding to a Draft List to notify nobody, so that no one is alerted about a link they don't have.
32. As an Owner, I want a Board feed entry when I add to an assigned List, so that I have a record.
33. As an Owner, I want a completed List to stop being completed when I add a Task, so that progress stays honest.
34. As an Assignee, I want the tag to stay after I finish the Task, so that the history is not lost.

### Status and Notes
35. As an Owner or Assignee, I want buttons instead of a status dropdown, so that I act in one click.
36. As an Owner or Assignee, I want an open Task to offer Blocked and Done, so that I only see valid moves.
37. As an Owner or Assignee, I want a Blocked Task to offer Done and Reopen, so that I can resolve or reset it.
38. As an Owner or Assignee, I want a Done Task to offer Reopen, so that an accidental Done is undone in one click.
39. As an Owner or Assignee, I want Reopen to make the Task open again and clear a completed List, so that state stays consistent.
40. As an Owner or Assignee, I want Blocked to reveal the Note field inline, so that I can say why without leaving.
41. As an Owner or Assignee, I want one Note field for what's blocking me and anything else, so that I don't split one thought across two boxes.
42. As an Owner or Assignee, I want the Note always optional, even when Blocked, so that I'm not forced to write.
43. As an Owner, I want my existing blocked reasons folded into the Note ahead of the old note, so that no information is lost.
44. As an Owner, I want the Board and feed to show the Note where they showed the blocked reason, so that blockers stay visible.

### Collapsed Tasks
45. As an Assignee, I want Tasks collapsed to a title and buttons by default, so that a long List is scannable.
46. As an Owner, I want collapsed rows to show checkbox, title, status badge and buttons, so that I can select and act without expanding.
47. As an Owner or Assignee, I want expanding to reveal instruction, tags, Deadline and Note, so that detail is one click away.
48. As an Owner or Assignee, I want a Done Task to keep Reopen visible while collapsed, so that undoing a mistake is immediate.
49. As a keyboard or screen-reader user, I want expanding to work as a standard disclosure, so that I can use it without a mouse.

### Removed Tasks
50. As an Assignee, I want a Task taken out of my List to remain as a "Removed" row with its title and date, so that it doesn't just vanish.
51. As an Assignee, I want Removed rows to have no buttons or Note, so that I can't act on dead work.
52. As an Assignee, I want a Task the Owner deleted to show as Removed too, so that I'm told either way.
53. As an Assignee, I want a live banner "Task removed: <title>" if my page is open, so that I notice.
54. As an Assignee, I want a Done Task that is removed shown as Removed, so that I'm told even about finished work.
55. As an Owner, I want removals from a Draft List to leave no record, so that no one is told about something they never had.
56. As an Owner, I want a re-added Task to clear its Removed row and come back as an Additional Task, so that the page isn't contradictory.
57. As an Owner, I want progress to exclude Removed rows, so that "2 of 5" reflects real work.
58. As an Owner, I want a List with only Done Tasks left to still count as completed, so that removals don't unfinish it.
59. As an Owner, I want removals recorded on the Board feed, so that I have an audit trail.

### Links
60. As an Assignee, I want a revoked link to say the List has been revoked and to ask for a new link, so that I know what to do.
61. As an Assignee, I want a replaced link to say it was replaced by a newer one, so that I'm not told it was revoked when it wasn't.
62. As an Assignee, I want a dead link to show no Task details, so that revoked access really is revoked.
63. As an Assignee with a stale open page, I want acting on it to show the same message instead of a raw error, so that I understand.
64. As an Owner, I want deleting a List or Person to give the Assignee the revoked message, so that there is no confusing half-state.

## Implementation Decisions

- **Same module.** All work is in the existing Task assignment module (ADR 0006); nothing imports across the boundary and it stays off unless configured.
- **Note replaces blocked reason.** The Task keeps one `note`; `blockedReason` is removed. A one-off, idempotent migration at deploy time writes `"<blocked reason>\n\n<note>"` where both exist, the blocked reason alone where there is no note, and drops the old field. Status-change events carry the Note where they carried the reason.
- **Status transitions are button posts.** Open to Blocked or Done, Blocked to Done or Open, Done to Open. Reopen clears completed-ness of the List as the current reopen path does. Only the Blocked button needs script (inline Note reveal); the buttons themselves are plain form posts. The same transitions serve Owner and Assignee pages.
- **Deadline** is one optional UTC instant on the Task. The browser submits the Owner's local date and time, with 23:59 as the default time when only a date is given; the server rejects unparseable values. Display is in the viewer's own time zone. Only the Owner's edit route may write it. Overdue is derived at render time (passed and not Done), never stored.
- **Add Task** is a modal dialog using the module's existing dialog opener pattern; a failed validation reopens it with input and error preserved.
- **Create List from selection.** A single request carries the selected Task ids, a name and an optional Person (existing id or new name). It creates the List, and when a Person is present the Assignment, as one unit that fully rolls back on failure, reusing the existing 50-Task cap and one-List rule.
- **Add to existing List** has two entry points (Tasks page selection, List page picker) converging on one add operation that enforces the one-List rule, and that clears a completed List.
- **Additional Task** is derived from time: the List records when it was first assigned, once, never reset by revoke or reassign; a Task whose addition time is after that is Additional. The tag is permanent and shown on both sides.
- **Removed Task record.** Removing or deleting a Task out of a List that has ever been assigned stores a record on the Assignment's List history with the title copied at removal time and the removal time; Draft Lists record nothing. Re-adding clears the record and the Task is Additional. Progress and completion are computed over live Tasks only. Deleting a whole List or Person is not a per-Task removal; it revokes the link.
- **Inactive link states.** The link page distinguishes revoked from replaced from the stored assignment history, hides Task details in both, and answers Assignee action posts on inactive links with the same message as a page rather than a bare error.
- **Live events.** New event kinds for Task added to an assigned List and Task removed feed both the Assignee's link stream (banner) and the Owner's Board feed, through the existing event store and live stream. No new transport.
- **Sidebar** is rendered from the Owner's Lists with Draft/Assigned and done/total over live Tasks; it refreshes via the existing live updates and collapses above the content on narrow screens.
- **No out-of-band notification.** A Person has only a name, so nothing is emailed or pushed.

## Testing Decisions

- **One seam.** Test through HTTP only: Fastify `inject` against the in-memory MongoDB, with an Owner browser and an Assignee browser, as the existing workflow tests do. Assert on responses, redirects, rendered markup and stored documents. Do not test internals or add unit tests of helpers.
- **A good test** states a behaviour an Owner or Assignee would notice (what they see after an action) and survives refactors of rendering or storage.
- **Cover:** each status transition and which buttons appear for each status on both pages; Note optional when Blocked; migration over both-set, reason-only, note-only and neither, run twice; Deadline defaulting, rejection, Owner-only editing and Overdue (not shown when Done); create-and-assign atomicity and rejection of occupied Tasks; Additional Task before and after first assignment, across revoke and reassign to another Person; completed List clearing on add and on Reopen; Removed rows for removed and deleted Tasks, Draft Lists leaving none, re-add behaviour; progress excluding Removed rows; revoked versus replaced messages and stale posts; live events delivered to the right stream.
- **Prior art:** `test/assign/workflow.test.ts` (browser helper, Owner and Assignee flows, revoke scenario), `test/assign/task-view.test.ts` for rendered page assertions.

## Out of Scope

- Email, text message or push notification of any kind.
- Sorting by Deadline and Deadline reminders. The bot's Reminder concerns Channels; Assignees have none.
- Any change to the voice-notes bot, its dashboard or its Tasks.
- Per-Task rows for removals caused by deleting a whole List or Person.
- Re-ordering Tasks or Lists.

## Further Notes

- Tickets 01 to 08 in `issues/` are published as `ready-for-agent`; 01 and 07 can start immediately.
- The accessibility bar from earlier commits (focus return after dialogs, text as well as colour, keyboard disclosure) applies to every new control.
