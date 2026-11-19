# 33: Adopt a strict Content-Security-Policy

**What to build:** Owner and Assignee pages send a CSP such as `default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'` (exact policy is the maintainer's call). Possible only after inline scripts and handlers are gone. This gives a second line of defence if an escaping slip ever occurs.

**Blocked by:** 08, 31

**Status:** needs-triage

**Severity:** Medium

**Source:** [security-review](../../task-assignment-refresh/reviews/security-review.md) F5 CSP part (nonce'd or external scripts, `frame-ancestors`, `form-action`)

**Acceptance criteria:**

- [ ] Pages load and work with the CSP enforced (no violations in a browser run).
- [ ] The header is asserted on `/assign/*` and `/l/*`.
- [ ] No `unsafe-inline` for scripts.
