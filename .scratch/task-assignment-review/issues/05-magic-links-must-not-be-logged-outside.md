# 05: Magic links must not be logged outside local development

**What to build:** With no mail provider configured, a non-local deployment fails fast at startup instead of printing login links to stdout. The console mailer is available only for a loopback `PUBLIC_URL` or an explicit dev opt-in, is named to say it is dev-only, and `.env.example` documents the requirement. The login token is never printed at info level in production.

**Blocked by:** None

**Status:** needs-triage

**Severity:** Medium

**Source:** [security-review](../../task-assignment-refresh/reviews/security-review.md) F2 Magic-link emails are logged to the console by default; [code-smells](../../task-assignment-refresh/reviews/code-smells.md) Finding 10 note on `consoleMailer` logging the full message (dev-only; rename)

**Acceptance criteria:**

- [ ] Startup throws `AssignConfigError` when `RESEND_API_KEY` is empty and `PUBLIC_URL` is not loopback (and no explicit dev flag).
- [ ] The console mailer still works on a loopback `PUBLIC_URL` for local development.
- [ ] `.env.example` explains the rule.
- [ ] Config behaviour covered by the existing config tests.
