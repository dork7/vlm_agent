# Worklog: Task board on a single page

## 2026-11-19
- Grilled the design with the Owner and settled the model: Templates in the main list, per-List copies, idempotent "Create & copy link" with name entered on first open, Duplicate List.
- Wrote `.scratch/task-board-single-page/spec.md` (Status: ready-for-agent). Test seams agreed: HTTP workflow seam plus one store-migration test.
- Next: split into tickets, then implement. ADR 0007 and the `GLOSSARY.md` update are part of the implementation.
- Prototyped five UI variants in `src/assign/prototype-board.ts` (A to F). Variant F (select and share, side by side) chosen. Delete uses confirm instead of undo; rename added to the spec.
- Split the spec into tickets `issues/01` to `08`, all ready-for-agent. Prototype still uncommitted on `main`; it should go to a throwaway branch before ticket 03 removes it.
- Added retention requirement: nothing hard-deleted; soft delete with `deletedAt`/reason for Tasks, Lists, People; Done copies kept with `doneAt`. Updated spec and tickets 01, 02, 08. No analytics UI in scope.
- Breakdown approved by the Owner: split into 9 tickets (`issues/01` to `09`), retention as its own ticket 02, Variant F as the layout in ticket 05. Tickets 01, 02 and 04 can start first.
- Ticket 01 done on branch `tb-01`: `kind` (`template`/`copy`) on Tasks with idempotent backfill in `openAssignStore`; existing create/attach/detach/delete-List flows keep `kind` in step; ADR 0007 and Template glossary entry added.
