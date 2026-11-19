# 07: Hash passwords asynchronously and make password login uniform

**What to build:** Password hashing and verification no longer block the shared Node thread. Login for an unknown email or an account without a password does equivalent work (dummy verify against a fixed hash), so timing does not reveal account state. Passwords have a maximum length (for example 128). Argon2 parameters are unchanged unless the maintainer decides otherwise.

**Blocked by:** None

**Status:** needs-triage

**Severity:** Medium

**Source:** [security-review](../../task-assignment-refresh/reviews/security-review.md) F4 Synchronous argon2 on the event loop; password-login timing and DoS (measured ~31 ms per verify); [code-review](../../task-assignment-refresh/reviews/code-review.md) F12 bullet: password login does no hashing for unknown emails (timing oracle)

**Acceptance criteria:**

- [ ] Hash and verify use the async argon2 API.
- [ ] Unknown-email and no-password logins perform a dummy verify and return the same response as a wrong password.
- [ ] A password above the maximum length is rejected with a clear message.
- [ ] Covered by tests through the existing HTTP workflow test seam.
