# 06: Make rate limiting sound behind a proxy and bounded in memory

**What to build:** Rate limits key on the real client IP when running behind a reverse proxy, without letting a client spoof it. `ASSIGN_TRUST_PROXY` accepts a hop count or address list (documented), not just a boolean. The limiter forgets expired keys and caps its size so attacker-chosen keys cannot grow memory. Password login also has a per-IP limit and a global cap, and a victim's password login cannot be locked out by five bad guesses from an attacker without any IP-level cost to the attacker. In-process, restart-reset limits are documented as a known limit.

**Blocked by:** None

**Status:** needs-triage

**Severity:** Medium

**Source:** [security-review](../../task-assignment-refresh/reviews/security-review.md) F3 Rate limiting: proxy handling, unbounded memory, per-email-only password limit; [code-review](../../task-assignment-refresh/reviews/code-review.md) F12 bullet: `rate-limit.ts` never prunes keys; per-email limit lets anyone lock out password login

**Acceptance criteria:**

- [ ] Trust-proxy config accepts a hop count or list; boolean behaviour is not the only option, and config tests cover validation.
- [ ] Expired limiter keys are removed and the key map has a size cap (verified by a test).
- [ ] `/assign/password-login` has an IP-scoped limit in addition to the per-email one.
- [ ] Behind a configured proxy, two different clients do not share one bucket; a spoofed `X-Forwarded-For` beyond the trusted hops is ignored.
- [ ] Covered by tests through the existing HTTP workflow test seam.
