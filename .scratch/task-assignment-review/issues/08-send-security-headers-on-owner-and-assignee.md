# 08: Send security headers on Owner and Assignee pages

**What to build:** Responses from `/assign/*` and `/l/*` carry `X-Frame-Options: DENY` (and `frame-ancestors 'none'` once CSP lands), `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff`, and `Cache-Control: no-store` for authenticated and link pages, plus HSTS when cookies are secure. Pages cannot be framed, link codes and magic tokens do not leak through `Referer`, and authenticated pages are not cached by shared devices or proxies. A strict CSP is out of scope here because inline scripts and handlers still exist; see the CSP ticket.

**Blocked by:** None

**Status:** needs-triage

**Severity:** Medium

**Source:** [security-review](../../task-assignment-refresh/reviews/security-review.md) F5 No security headers or CSP (headers part only; CSP is a separate ticket); [security-review](../../task-assignment-refresh/reviews/security-review.md) F11 note: no Referrer-Policy on `/l/CODE` and `fail()` back links

**Acceptance criteria:**

- [ ] Probe responses for `/assign/*` and `/l/*` include the headers above.
- [ ] HSTS is present only when secure cookies are in use.
- [ ] Dashboard, Inventory and Telegram routes are unaffected (module hooks stay scoped).
- [ ] Covered by tests through the existing HTTP workflow test seam.
