# 14: Require re-authentication to set or change a password

**What to build:** Setting or changing a password requires the current password, or a fresh magic-link login within a short window, and the Owner is emailed when a password is set or changed. A stolen session can no longer plant a persistent credential that survives sign-out everywhere.

**Blocked by:** None

**Status:** needs-triage

**Severity:** Low

**Source:** [security-review](../../task-assignment-refresh/reviews/security-review.md) F7 Password can be set or changed without the current password or recent auth

**Acceptance criteria:**

- [ ] Setting a password from a session older than the re-auth window is refused until the Owner re-authenticates.
- [ ] Changing a password requires the current password.
- [ ] A notification email is sent on set/change (console mailer in tests).
- [ ] Covered by tests through the existing HTTP workflow test seam.
