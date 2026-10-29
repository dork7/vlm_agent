# 14: Markdown copies of Tasks and Notes

**What to build:** Whenever a User's Note or Task is saved, the bot also writes that User's Tasks and Notes as Markdown files: `<MARKDOWN_DIR>/<username>/tasks.md`, a checklist (open Tasks first, soonest due first, undated after, then done ones ticked, each with its due date and its Description beneath), and `<MARKDOWN_DIR>/<username>/notes.md` (newest first: Heading, when it was saved in the User's timezone, then its text). MongoDB stays the source of truth: both files are rewritten in full from MongoDB after each change, so they always match it. A write failure is logged and never fails the save or the reply. See spec story 79 and **Markdown copies**.

**Blocked by:** 02

**Status:** ready-for-agent

- [x] `MARKDOWN_DIR` is read from configuration, defaulting to `./markdown`.
- [x] Through Seam 1, saving a Task writes `tasks.md` in the sender's own folder listing all their Tasks in order, with due dates and Descriptions, done ones ticked.
- [x] Through Seam 1, saving a Note writes `notes.md` in the sender's own folder, newest first, with Heading, saved time in the User's timezone and text.
- [x] Each User's files hold only their own Tasks and Notes.
- [x] The files are rebuilt from MongoDB on every change, so a deleted or hand-edited file is restored on the next save.
- [x] When the files can't be written, the Note or Task is still saved and the reply is unchanged.
- [ ] Manually: after typing a to-do and a note to the bot on Telegram, both files show up in the folder.

## Comments

- Implemented through Seam 1 against a real temporary folder. Task ordering is shared with ticket 13's list (`src/core/tasks.ts`), so the chat list and `tasks.md` always agree.
- Usernames are made safe for folder names (anything outside letters, digits, `_`, `.`, `-` becomes `_`). Files are written via a temporary file and renamed, so a reader never sees half a file.
