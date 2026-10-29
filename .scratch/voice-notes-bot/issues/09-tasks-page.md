# 09: Tasks page

**What to build:** A logged-in User sees a separate Tasks page with Open and Done tabs listing only their own Tasks, showing Heading, Description, due date and source Transcript. They can mark a Task done or reopen it, edit its Heading, Description and due date, and delete it.

**Blocked by:** 02, 08

**Status:** ready-for-agent

- [x] Through Seam 2: the Open and Done tabs list only the User's Tasks in the matching status.
- [x] Marking done moves a Task to Done; reopening moves it back.
- [x] Editing changes Heading, Description and due date; changing the due date clears any Reminder-sent marker (for ticket 11).
- [x] A User cannot view, change or delete another User's Task.
- [x] Deleting a Task removes it.
- [ ] Manually: in a browser, open `/`, switch tabs, mark a Task done and reopen it, edit its due date and delete it.

## Comments

- Implemented in `src/dashboard/dashboard.ts` with views `tasks.ejs` (tabs) and `task.ejs` (edit form). Routes: `GET /tasks?tab=open|done` (open is the default; order comes from `ownTasksInOrder`), `GET /tasks/:id`, `POST /tasks/:id` (edit, 303 back to the Task), `POST /tasks/:id/done`, `POST /tasks/:id/reopen`, `POST /tasks/:id/delete`. Another User's Task, a missing one and a malformed ID all get 404. The list shows Heading, due date (on the User's clock), Description and the original Transcript in a collapsible block.
- `GET /` now redirects to `/tasks` (behind the dashboard login), and the nav has Tasks and Notes links.
- The edit form takes a date and an optional time on the User's own clock (`<input type="date">`/`type="time"`); both empty means no due date. An empty Heading, a non-calendar date or a time without a date is a 400 and changes nothing. The Description may be empty.
- A due date change goes through `changeTaskDue` (only when the due date actually changed, so editing just the Heading or Description does not re-send a Reminder that already went out). Tested by calling `sendDueReminders` before and after the edit.
- Done, reopen, edit and delete rewrite the User's Markdown copies. Reopening does not clear the Reminder-sent marker, so a reopened overdue Task is not reminded again unless its due date is changed.
- Code review fixes: `dueFromForm` and `sameDue` moved into `src/core/tasks.ts`. Done and reopen now go through `setTaskStatus` in `src/core/tasks.ts`, the same operation the Reminder "Done" button uses, instead of writing `database.tasks` directly. `changeTaskDue` takes the Task's `ObjectId` and an injected `now`, and the dashboard takes an optional `now` too. A Task's owner is looked up with the shared `findOwn` helper in `src/dashboard/http.ts` (also used for Notes).
