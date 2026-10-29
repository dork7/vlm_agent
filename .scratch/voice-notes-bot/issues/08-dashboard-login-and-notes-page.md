# 08: Dashboard login and Notes page

**What to build:** A User opens the web dashboard, logs in with HTTP basic auth checked against Users in MongoDB (scrypt hashes, constant-time comparison), and sees a server-rendered EJS Notes page listing only their own Notes, newest first. They can search Notes, open one to see its text and its original Transcript, edit its Heading and text (the original Transcript stays unchanged), and delete it. Pages use plain HTML forms with redirect-after-post; no frontend build.

**Blocked by:** 01

**Status:** ready-for-agent

- [x] Through Seam 2: no credentials or wrong credentials get 401; correct credentials get the page.
- [x] A User sees only their own Notes; another User's Note cannot be viewed, edited or deleted by ID.
- [x] Search filters the list by Heading and text.
- [x] Editing a Note changes its Heading and text and leaves its original Transcript unchanged.
- [x] Deleting a Note removes it from the list.
- [ ] Manually: in a browser, log in at `/notes`, search, open a Note, edit it and delete it.

## Comments

- Implemented in `src/dashboard/` as a Fastify plugin with EJS views rendered through `ejs.renderFile` (no `@fastify/view`). URL-encoded form bodies are parsed by a small content-type parser inside the plugin. `buildServer` mounts it when given `dashboard` options; `/health`, `/inventory` and the webhook stay outside its login.
- Basic auth looks the User up by username and checks the scrypt hash with `timingSafeEqual`. An unknown username is checked against a decoy hash, so it takes as long as a wrong password. A 401 carries `WWW-Authenticate: Basic` so browsers prompt.
- Routes: `GET /notes?q=` (newest first; search is a case-insensitive plain-text match on Heading or text), `GET /notes/:id` (Heading, text, original Transcript, edit form, delete button), `POST /notes/:id` (edit, 303 back to the Note; an empty Heading or text is a 400), `POST /notes/:id/delete` (303 to `/notes`). Another User's Note, a missing one and a malformed ID all get 404.
- Editing and deleting rewrite the User's Markdown copies, as the spec asks for dashboard changes; a write failure is logged and doesn't fail the change.
- There is no `/` route yet; ticket 09 (Tasks page) can add a landing redirect alongside its nav link.
