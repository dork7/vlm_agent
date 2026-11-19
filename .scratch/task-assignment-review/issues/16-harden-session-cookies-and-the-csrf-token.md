# 16: Harden session cookies and the CSRF token

**What to build:** Sessions have an absolute lifetime (for example 90 days) in addition to the sliding refresh. The CSRF token is bound to the session (HMAC) or signed, and compared in constant time. `__Host-` cookie names are used where the path allows. `ta_access` is scoped to `/assign`; the Owner-vs-Assignee view-counting check that currently relies on seeing it at `/l/*` gets another mechanism. The report notes this last point interacts with `workflow.ts` view counting, so check it before scoping the cookie.

**Blocked by:** 03

**Status:** needs-triage

**Severity:** Low

**Source:** [security-review](../../task-assignment-refresh/reviews/security-review.md) F9 Cookie scoping and session lifetime; [code-review](../../task-assignment-refresh/reviews/code-review.md) F12 bullet: CSRF is a plain unsigned double-submit cookie

**Acceptance criteria:**

- [ ] A session older than the absolute cap must log in again even if refreshed continuously.
- [ ] A forged CSRF cookie not derived from the session is rejected.
- [ ] Owner visits to `/l/:code/view` are still excluded from Assignee view counts.
- [ ] Covered by tests through the existing HTTP workflow test seam.
