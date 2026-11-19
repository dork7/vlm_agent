# 03: Percent-encoded paths must not bypass CSRF checks or the /l/ rate limit

**What to build:** CSRF enforcement, CSRF cookie issuance, the `/l/` per-IP limit and the no-login check apply to every request that reaches an Owner or Assignee route, regardless of how the path is spelled (`/%61ssign/logout`, `/%6c/CODE`). Scoping is based on the matched route or on registering the Owner and Assignee routes in separate scopes with their own hooks, not on `startsWith` over the raw URL.

**Blocked by:** None

**Status:** needs-triage

**Severity:** High

**Source:** [security-review](../../task-assignment-refresh/reviews/security-review.md) F1 CSRF protection, CSRF cookie issuance and /l/ rate limit skipped by percent-encoded path (Confirmed by probe; High, Medium if SameSite=Lax is weighed); [security-review](../../task-assignment-refresh/reviews/security-review.md) F10 residual: the per-IP limiter is the only throttle on view-row amplification and is restored by this fix

**Acceptance criteria:**

- [ ] `POST /%61ssign/logout` without a CSRF token returns 403, same as `/assign/logout`.
- [ ] `/%61ssign/password-login` without a CSRF token is rejected.
- [ ] Requests to `/%6c/<code>` count against the same `/l/` limit and hit 429 after the limit.
- [ ] The no-login path check in `auth.ts` is not bypassable by an encoded path.
- [ ] Covered by tests through the existing HTTP workflow test seam.
