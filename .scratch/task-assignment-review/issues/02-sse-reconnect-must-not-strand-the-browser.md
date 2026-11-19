# 02: SSE reconnect must not strand the browser on a rotated refresh token

**What to build:** An Owner whose access token has expired and whose browser reconnects `/assign/events` is never logged out of every device as a side effect. The events endpoint either does not rotate the refresh token (a missing or expired access token gets a response that makes the page reload through a normal request), or the rotated cookies actually reach the browser. A request does not rotate twice (`requireOwner` then the handler). Reuse detection of a stale refresh token revokes only that token's family rather than every session of the Owner, keeping the security intent of the 30 s grace.

**Blocked by:** None

**Status:** needs-triage

**Severity:** High

**Source:** [code-review](../../task-assignment-refresh/reviews/code-review.md) F3 SSE endpoint loses the rotated refresh cookie; next request after 30 s revokes all sessions (Confirmed); [code-review](../../task-assignment-refresh/reviews/code-review.md) F11 Rotated-token handling: duplicate refresh tokens per request, all-session revoke on slow clients (Likely); [security-review](../../task-assignment-refresh/reviews/security-review.md) F9 last bullets: rotation race and reuse-detection revoking on legitimate stale tabs

**Acceptance criteria:**

- [ ] `GET /assign/events` with an expired access cookie never leaves the browser holding a rotated-away refresh token.
- [ ] After such a reconnect, a request made more than 30 s later still succeeds and no sessions are revoked.
- [ ] `/assign/password-offer`, `/assign/settings/password` and `/assign/logout-all` insert one refresh token per request, not two.
- [ ] Presenting a stale rotated token revokes only its own family; other devices stay signed in.
- [ ] Covered by tests through the existing HTTP workflow test seam.
