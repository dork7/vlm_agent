# 08: Dashboard login and Notes page

**What to build:** A User opens the web dashboard, logs in with HTTP basic auth checked against Users in MongoDB (scrypt hashes, constant-time comparison), and sees a server-rendered EJS Notes page listing only their own Notes, newest first. They can search Notes, open one to see its text and its original Transcript, edit its Heading and text (the original Transcript stays unchanged), and delete it. Pages use plain HTML forms with redirect-after-post; no frontend build.

**Blocked by:** 01

**Status:** ready-for-agent

- [ ] Through Seam 2: no credentials or wrong credentials get 401; correct credentials get the page.
- [ ] A User sees only their own Notes; another User's Note cannot be viewed, edited or deleted by ID.
- [ ] Search filters the list by Heading and text.
- [ ] Editing a Note changes its Heading and text and leaves its original Transcript unchanged.
- [ ] Deleting a Note removes it from the list.
