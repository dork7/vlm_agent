# 02: Agent Bot definitions and web console CRUD

**What to build:** Add the `agentBots` collection and `/agents` console pages behind the dashboard login: list, create, edit, delete. Fields: name, Telegram token, Dataset, Persona (tone, language, model, temperature, max results), Conversation Guide Markdown editor. Token is never shown back in full. Spec stories 5–7.

**Blocked by:** 01

**Status:** done

- [ ] Unauthenticated requests to `/agents` are rejected.
- [ ] Create/edit validates required fields and shows errors with input kept.
- [ ] Token is masked after save.
- [ ] Conversation Guide saved as Markdown and reloaded in the editor.
- [ ] Covered by tests through the HTTP seam.
