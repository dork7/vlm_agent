# 10: User portal

**What to build:** An admin manages Users from an admin-only portal page: create a User (username, password, admin flag, timezone), add and remove Channel Identities (Telegram in v1), set a User's timezone, reset a User's password, and delete a User. Deleting a User removes their access to both the bot and the dashboard. Non-admins cannot reach the portal. There is no self sign-up.

**Blocked by:** 08

**Status:** ready-for-agent

- [ ] Through Seam 2: a non-admin User gets 403 on every portal page and action.
- [ ] An admin can create a User; the new User can log in with the given password and the password is stored only as a hash.
- [ ] Adding a Telegram Channel Identity lets that sender use the bot; removing it makes the bot refuse them (verified through Seam 1).
- [ ] Resetting a password makes the old one fail and the new one work.
- [ ] Deleting a User makes both dashboard login and bot use fail for them.
- [ ] A Channel Identity can't belong to two Users.
