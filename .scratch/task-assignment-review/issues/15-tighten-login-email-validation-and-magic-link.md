# 15: Tighten login email validation and magic-link token hygiene

**What to build:** The login response and latency are uniform for eligible and ineligible addresses (the mail send is queued with error logging, so a provider failure does not become a 500 for eligible addresses only). Email validation rejects display-name forms such as `Bob<me@evil.test>` and stores a normalised address. Issuing a newer login link, or a successful login, invalidates older unused tokens for that email.

**Blocked by:** None

**Status:** needs-triage

**Severity:** Low

**Source:** [security-review](../../task-assignment-refresh/reviews/security-review.md) F8 Account enumeration and mail-abuse details on /assign/login

**Note:** Timing difference is Medium confidence in the report.

**Acceptance criteria:**

- [ ] `Bob<me@evil.test>` and addresses with `<>,;"` are rejected.
- [ ] Provider send failure returns the same response as success for eligible addresses.
- [ ] Only the newest unused login token for an email works.
- [ ] Covered by tests through the existing HTTP workflow test seam.
