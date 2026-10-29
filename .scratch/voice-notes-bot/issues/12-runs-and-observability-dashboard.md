# 12: Runs and the observability dashboard

**What to build:** Every inbound message is recorded as one Run (ADR 0003): Channel and sender, status (in progress, succeeded, failed, awaiting Clarification, refused), resulting type, and an ordered list of stages (received, download, conversion, transcription, classification with every model attempt, tool calls, reply), each with start time, duration, outcome and details, plus any error and the stage it happened in. Admins see an observability dashboard: a list of recent Runs with outcome and total time, a detail page per Run, and totals (messages per day, counts by Note/Task/Query, failure rate, average time per stage, how often fallback happened). Non-admins are denied.

**Blocked by:** 03, 04, 05, 07, 08

**Status:** ready-for-agent

- [x] Through Seam 1, each scenario (Note, Task, Query, Clarification pending and answered, refused sender, model fallback, total failure, transcription failure) leaves one Run with the correct status, type and stages.
- [x] Model attempts on the Run show each model tried, its outcome and failure reason, plus tokens and cost where reported.
- [x] Tool calls on the Run show tool, endpoint, HTTP status and latency.
- [x] Through Seam 2, the Run list, Run detail and totals render for an admin and return 403 for a non-admin.
- [x] Runs awaiting a Clarification are clearly marked in the list.

## Comments

- `src/core/runs.ts` defines the Run document and a recorder. `core.handleMessage` saves an in-progress Run as soon as a message is claimed (so one cut short by a restart still shows), times each stage, and saves the finished Run. `HandledMessage.runId` names it. A duplicate delivery gets no Run of its own.
- Stages: `received` (sender check), `download`, `conversion`, `transcription`, `classification` (the first model call), `tool-call` (each Inventory lookup), `query-answer` (each model call after a Query's lookups), `reply` (sending the final event). Each stage has a start time, duration, outcome, error and details. A failed Run's `error` names the last failed stage, or else the last stage (for example `received` for a Voice Message over 5 minutes, which counts as failed).
- Status comes from the final event: refused, failed (error or voice-too-long), awaiting-clarification, otherwise succeeded. Types are `note`, `task`, `query`, `task-list` and `command`. When a Clarification is answered and filed, every Run still awaiting it (including re-asks) becomes succeeded with the chosen type. The answering Run is its own succeeded Run, linked by `clarificationId`. An answer to a Clarification that is no longer pending is a succeeded Run with no type.
- The Transcriber now takes an optional `timeStage` callback and times download, conversion and transcription separately. A Transcriber that doesn't call it (such as the older test fakes) records no transcription stages.
- `ModelAttempt` now has `tokens` (prompt/completion/total) and `cost` (USD) when OpenRouter's `usage` reports them, including for an unusable answer. A request error has neither.
- Dashboard (admins only, 403 otherwise): `GET /runs` (latest 100, newest first, outcome, type and total time; Runs awaiting a Clarification have a highlighted badge and a count at the top), `GET /runs/:id` (stages, model attempts with reason/tokens/cost, tool calls with endpoint/HTTP status/latency, and the error with its stage), `GET /runs/totals` (messages per day for the latest 30 days with messages, on the admin's clock; Note/Task/Query counts; failure rate over finished Runs; average time per stage; fallback = Runs with a model stage that needed a second attempt, out of Runs that called a model). Admins get a "Runs" nav link.
- `render` in `src/dashboard/http.ts` now passes `viewer` to every view. Admins see "Runs" and "Users" links in the nav. Fixed an existing bug: `render` used EJS `async: true` while views call `include` without `await`, so the shared header rendered as `[object Promise]`.
- Tests: `test/runs.test.ts` (Seam 1) and `test/dashboard-runs.test.ts` (Seam 2). `test/query.test.ts` now allows the `runs` collection and checks that it holds no item data.
- Not checked by hand: the pages in a browser against real Runs.
