# 01: Template and copy Task model

**What to build:** Tasks gain a `kind` of `template` or `copy`. A **Template** is in no List and is never assigned; a **copy** is in exactly one List. On upgrade, existing Tasks already in a List become `copy` and unlisted ones become `template`. Nothing is moved or deleted. Add ADR 0007, "Task templates and per-List copies", superseding "a Task is in at most one List" (note that "Group" is not a term; "List" is), and add **Template** to `GLOSSARY.md`. Existing pages and flows keep working unchanged. Spec story 29.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] `kind` exists on Tasks and the backfill gives every existing Task the right value, leaving List membership and data intact.
- [ ] Running the backfill twice changes nothing.
- [ ] ADR 0007 and the glossary entry are written, and the old one-List rule is marked superseded.
- [ ] One test on the store migration seam, with the existing HTTP workflow tests still passing.
