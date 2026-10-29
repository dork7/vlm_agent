# 12: Runs and the observability dashboard

**What to build:** Every inbound message is recorded as one Run (ADR 0003): Channel and sender, status (in progress, succeeded, failed, awaiting Clarification, refused), resulting type, and an ordered list of stages (received, download, conversion, transcription, classification with every model attempt, tool calls, reply), each with start time, duration, outcome and details, plus any error and the stage it happened in. Admins see an observability dashboard: a list of recent Runs with outcome and total time, a detail page per Run, and totals (messages per day, counts by Note/Task/Query, failure rate, average time per stage, how often fallback happened). Non-admins are denied.

**Blocked by:** 03, 04, 05, 07, 08

**Status:** ready-for-agent

- [ ] Through Seam 1, each scenario (Note, Task, Query, Clarification pending and answered, refused sender, model fallback, total failure, transcription failure) leaves one Run with the correct status, type and stages.
- [ ] Model attempts on the Run show each model tried, its outcome and failure reason, plus tokens and cost where reported.
- [ ] Tool calls on the Run show tool, endpoint, HTTP status and latency.
- [ ] Through Seam 2, the Run list, Run detail and totals render for an admin and return 403 for a non-admin.
- [ ] Runs awaiting a Clarification are clearly marked in the list.
