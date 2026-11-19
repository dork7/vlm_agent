# 19: Remove wording that says the dashboard needs a login

**What to build:** Commit `11dccb1` made the dashboard open without a login, but some text still describes the old login. Update it to match how the dashboard works now (or what issue 17 decides).

**Blocked by:** none

**Status:** ready-for-agent

- [ ] `src/main.ts` default-password warning: "change the password from the dashboard after logging in" no longer matches, since the password now only matters for HTTP Basic credentials.
- [ ] ADR for the Voice Assistant (see issue 18): "joinable by the logged-in User alone" becomes the current dashboard User.
- [ ] Issue 15: "a logged-in User" and the criterion "not logged in is 401". Requests without credentials now get a token as the first admin (`test/dashboard-voice.test.ts`, "opens the page, client and a voice session without credentials"). Add a comment saying this changed, rather than rewriting the history.
- [ ] Comments in `src/dashboard/` that still say "logged-in" (e.g. `render` in `http.ts`) are updated.
