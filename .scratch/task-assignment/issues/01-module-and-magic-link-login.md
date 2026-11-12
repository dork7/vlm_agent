# 01: Module setup and magic-link login

**What to build:** The `src/assign/` module, registered on the existing server under `/assign` only when `ASSIGN_JWT_SECRET` and `PUBLIC_URL` are set, using the bot's MongoDB connection with its own `ta_` collections and indexes. An owner enters an email at `/assign/login` and gets a magic link by email (Resend, or the console when `RESEND_API_KEY` is unset). Following it signs them up (subject to `SIGNUP_MODE`) or logs them in, and lands on an empty Board page. See spec stories 1, 4, 5 and **Module boundary**, **Auth**, **Email**.

**Blocked by:** none

**Status:** ready-for-agent

- [ ] With the module unconfigured, `/assign` is a 404 and the bot starts exactly as before.
- [ ] Requesting a link for any email gives the same response and page, whether or not the email can sign in.
- [ ] The emailed link logs the owner in once; a second use, or use after 15 minutes, is refused. Only a hash of the token is stored.
- [ ] `SIGNUP_MODE=allowlist` (with `ASSIGN_ALLOWED_EMAILS`) sends no link to other emails; `open` creates an account on first login.
- [ ] Link requests are limited to 5 per 15 minutes per email and per IP, and new accounts to 5 per hour per IP.
- [ ] An architecture test fails if `src/assign/` imports from `src/core`, `src/telegram` or `src/dashboard`, or they import from it.
- [ ] Resend is called with the API key, sender and the link; with no key, the link is logged to the console instead.
