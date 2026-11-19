# 08: Rename a List inline

**What to build:** Rename a List from the Lists panel: a ✎ button next to the name (works by touch) and double-click on the name, turning it into a text field. Enter or clicking away saves; Esc cancels; an empty name keeps the old one. Names are limited to 80 characters. Spec stories 5, 37, 39.

**Blocked by:** 05

**Status:** ready-for-agent

- [ ] Rename saves on Enter and blur, cancels on Esc, ignores an empty name.
- [ ] The name limit is enforced on the server with a clear message.
- [ ] An Assignee's open page picks up the new name through the existing live updates if the List name is shown there.
- [ ] Covered by tests through the HTTP workflow seam (the existing edit-List request may already cover the server side).
