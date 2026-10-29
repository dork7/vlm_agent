# 09: Tasks page

**What to build:** A logged-in User sees a separate Tasks page with Open and Done tabs listing only their own Tasks, showing Heading, Description, due date and source Transcript. They can mark a Task done or reopen it, edit its Heading, Description and due date, and delete it.

**Blocked by:** 02, 08

**Status:** ready-for-agent

- [ ] Through Seam 2: the Open and Done tabs list only the User's Tasks in the matching status.
- [ ] Marking done moves a Task to Done; reopening moves it back.
- [ ] Editing changes Heading, Description and due date; changing the due date clears any Reminder-sent marker (for ticket 11).
- [ ] A User cannot view, change or delete another User's Task.
- [ ] Deleting a Task removes it.
