# 19: Small input-handling hardening: backPath, form parser, feed read marker

**What to build:** `backPath` only echoes same-host paths that start with a single `/` (never `//`). The urlencoded parser builds a null-prototype object or Map so `__proto__` keys do nothing. Marking activity as read moves from `GET /assign/feed` to a POST (or is otherwise not triggerable cross-site).

**Blocked by:** None

**Status:** needs-triage

**Severity:** Low

**Source:** [security-review](../../task-assignment-refresh/reviews/security-review.md) F12 `backPath` can emit a protocol-relative URL (Medium confidence, far-fetched); [security-review](../../task-assignment-refresh/reviews/security-review.md) F15 bullets: urlencoded parser prototype assignment; `GET /assign/feed` mutates state

**Acceptance criteria:**

- [ ] A Referer path beginning `//` produces a safe fallback back link.
- [ ] A `__proto__=a&__proto__=b` body does not change the parsed object's prototype.
- [ ] A cross-site GET to the feed does not advance `lastSeenEventId`.
- [ ] Covered by tests through the existing HTTP workflow test seam.
