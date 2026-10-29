# 10: User portal

**What to build:** An admin manages Users from an admin-only portal page: create a User (username, password, admin flag, timezone), add and remove Channel Identities (Telegram in v1), set a User's timezone, reset a User's password, and delete a User. Deleting a User removes their access to both the bot and the dashboard. Non-admins cannot reach the portal. There is no self sign-up.

**Blocked by:** 08

**Status:** ready-for-agent

- [x] Through Seam 2: a non-admin User gets 403 on every portal page and action.
- [x] An admin can create a User; the new User can log in with the given password and the password is stored only as a hash.
- [x] Adding a Telegram Channel Identity lets that sender use the bot; removing it makes the bot refuse them (verified through Seam 1).
- [x] Resetting a password makes the old one fail and the new one work.
- [x] Deleting a User makes both dashboard login and bot use fail for them.
- [x] A Channel Identity can't belong to two Users.
- [ ] Manually: in a browser, log in as an admin at `/users`, create a User, add a Telegram Channel Identity and message the bot as them, reset their password, then delete them.

## Comments

- Seams: tested through Seam 2 (Fastify injection, real in-memory MongoDB) in `test/dashboard-users.test.ts`; the bot side of Channel Identities and deletion is checked through Seam 1 (`core.handleMessage` and `core.sendDueReminders`) against the same database.
- `src/dashboard/users-portal.ts` is a child plugin registered inside the dashboard plugin, so it shares the basic-auth login and form parser and adds a `preHandler` that gives non-admins 403 on every route. The shared helpers (`field`, `render`, `notFound`, `parseId`, `badRequest`) moved from `dashboard.ts` into `src/dashboard/http.ts`.
- Routes: `GET /users` (list and create form), `POST /users`, `GET /users/:id`, `POST /users/:id/identities`, `POST /users/:id/identities/remove`, `POST /users/:id/timezone`, `POST /users/:id/password`, `POST /users/:id/delete`. Changes redirect with 303 to the User's page (to `/users` after a delete); a refusal is a 400 with the reason in plain text; an unknown or malformed User ID is a 404.
- The User operations live in `src/users.ts` (`createUser`, `addChannelIdentity`, `removeChannelIdentity`, `resetPassword`, `setTimezone`, `deleteUser`) and throw `UserChangeError` for refusals: empty username or password, taken username, invalid IANA timezone, empty Channel ID, Channel Identity already on another User. The "one User per Channel Identity" rule relies on the existing unique index on `channelIdentities`; adding one the User already has does nothing (`$addToSet`). The same ID on a different Channel is allowed.
- An empty timezone means the configured default (the field is unset). Passwords are taken as typed, not trimmed.
- Deleting a User also deletes their Notes, Tasks and Clarifications. Otherwise their open Tasks would still send Reminders to their old Channel Identity. Their Markdown copies on disk are left in place; the portal isn't given `MARKDOWN_DIR`. An admin can't delete themselves (400), so the last admin can't lock everyone out that way. Two admins can still delete each other.
- Not done: removing a Channel Identity doesn't change Tasks already addressed to it, so their Reminders still go there. The nav has no "Users" link yet, because the header doesn't know whether the viewer is an admin; a later ticket (such as Observability) can add it once the header knows that.

