# 02: Sessions, passwords and CSRF

**What to build:** Sessions as a 15-minute HS256 access JWT plus a 30-day rotating refresh token, both in httpOnly cookies. After the first login, an optional "Set a password?" page with Skip; password login on the login page once set; a settings page to set or change it. Logout, "sign out everywhere", and a double-submit CSRF token on every non-GET `/assign` route. See spec stories 2–4 and **Auth**.

**Blocked by:** 01

**Status:** ready-for-agent

- [ ] An expired access token is renewed silently from the refresh token, which is rotated; reusing an old refresh token revokes all of that owner's sessions.
- [ ] `/assign` pages without a valid session redirect to the login page.
- [ ] The first login offers a password with a Skip; skipping keeps magic-link login only.
- [ ] Passwords under 10 characters are refused; they're stored with argon2id; wrong passwords are limited to 5 per 15 minutes per email, with the same message as an unknown email.
- [ ] Logout revokes this session; "sign out everywhere" and a password change revoke all of them.
- [ ] A non-GET `/assign` request without a matching CSRF token is refused with 403.
- [ ] Cookies are httpOnly and SameSite=Lax, and Secure when `PUBLIC_URL` is https.
