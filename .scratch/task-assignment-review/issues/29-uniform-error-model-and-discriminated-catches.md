# 29: Uniform error model and discriminated catches

**What to build:** Domain functions throw a typed `UserError` (or return a shared Result) handled by one Fastify error handler, replacing the mix of `fail`, `addTaskFailure`, `string | null` returns and ad hoc catches. Catches discriminate on duplicate key (11000) and rethrow or log everything else, so a database outage is not reported as "Could not assign". Compensation (rollback) blocks use one uniform helper, consistent with ADR 0006's decision to avoid replica-set transactions. The 500 returned for a validation-like failure is corrected.

**Blocked by:** 26

**Status:** needs-triage

**Severity:** Low

**Source:** [code-smells](../../task-assignment-refresh/reviews/code-smells.md) Finding 14 Inconsistent error handling; [code-smells](../../task-assignment-refresh/reviews/code-smells.md) Refactoring plan step 5 (error part)

**Acceptance criteria:**

- [ ] No bare `catch {` swallows non-duplicate-key errors; failures are logged via `request.log`.
- [ ] Validation failures use one path and status code convention.
- [ ] A simulated DB error in assign surfaces as a server error, not a user message.
- [ ] Covered by tests through the existing HTTP workflow test seam.
