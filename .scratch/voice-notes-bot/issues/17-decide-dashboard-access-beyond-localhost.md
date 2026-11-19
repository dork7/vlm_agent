# 17: Decide how the dashboard is protected when reachable beyond this machine

**What to build:** Since commit `11dccb1`, anyone who can reach the dashboard is the first admin. `HOST` defaults to `127.0.0.1`, which keeps that to this machine. But `HOST` has to be set to reach the app from outside, for Telegram's webhook mode or to use the Voice page from another device over HTTPS (README), and then the whole dashboard, including Users and Runs, is open to that network. Decide what happens in that case, then record it in an ADR. Options:

- Leave it to the operator: document it and print a startup warning when `HOST` isn't loopback.
- Require HTTP Basic login again whenever `HOST` isn't loopback, or behind a `DASHBOARD_OPEN=true` flag.
- Serve the dashboard on its own loopback-only listener, separate from the webhook.

**Blocked by:** none

**Status:** needs-triage

- [ ] A decision is made and recorded as an ADR (also covering why the login was removed).
- [ ] README and `.env.example` (`HOST`) describe the behaviour that was chosen.
- [ ] Tests cover the chosen behaviour for a loopback and a non-loopback `HOST`.

## Comments

- Brought up while merging PR #4. Issue 08 originally specified HTTP Basic login checked against Users. That code (`authenticate`) still exists and is used when credentials are sent.
