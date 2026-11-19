# 18: Harden no-login (local) mode

**What to build:** No-login mode is refused when `NODE_ENV=production`, validates the `Host` header against `PUBLIC_URL`, logs a loud startup warning, and no longer depends on a hard-coded placeholder JWT secret being reachable from a tunnel or reverse proxy forwarding to localhost.

**Blocked by:** None

**Status:** needs-triage

**Severity:** Low

**Source:** [security-review](../../task-assignment-refresh/reviews/security-review.md) F14 noLogin mode weaknesses

**Acceptance criteria:**

- [ ] Startup refuses no-login with `NODE_ENV=production`.
- [ ] A request with a mismatched `Host` is rejected in no-login mode (DNS rebinding).
- [ ] A startup warning is logged.
- [ ] Covered by config tests and the HTTP workflow seam.
