# 01: A typed message becomes a Note

**What to build:** The first end-to-end slice, including the project skeleton. When the app starts with no Users, it creates the first admin from configuration, with a Telegram Channel Identity. That admin types a message to the bot on Telegram (long polling). The bot immediately replies "processing…", sends the text to the channel-neutral core, which asks a single OpenRouter model to produce a Heading, saves a Note (Heading, text, original Transcript, owner, source) in MongoDB, and the Telegram adapter edits the processing reply to "Saved Note: <Heading>". A sender whose Channel and ID match no User's Channel Identity gets a polite refusal and nothing else happens.

In this slice the classifier only needs to produce Notes; later tickets add Task, Query and Clarification. Set up the single Node.js + TypeScript package, one Fastify server, startup configuration validation, the MongoDB connection, Vitest with an in-memory MongoDB, and a fake OpenRouter for tests. Respect ADR 0005: the core never imports grammY or Telegram types; the adapter turns updates into channel-neutral inbound messages and core events into Telegram calls.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [x] The project installs, typechecks, and its test suite runs with one command each; one command starts the app locally.
- [x] Startup fails with a clear message naming any missing required environment variable.
- [x] With no Users in the database, startup creates one admin User from the configured username, password (stored only as a scrypt hash with a per-user salt) and Telegram Channel Identity; with Users present, it creates nothing.
- [x] Through the core entry point (Seam 1), a typed message from a known Channel Identity produces a processing-started event and then a result event naming the saved Note's Heading, and the Note is stored with its owner, Heading, text and original Transcript.
- [x] A message from an unknown Channel Identity produces a refusal event and stores nothing.
- [x] The core has no dependency on grammY or any Telegram type.
- [ ] Manually: typing to the bot on Telegram shows "processing…" edited into "Saved Note: <Heading>".

## Comments

- Implemented. All criteria are covered by tests except the manual Telegram check, which needs a real bot token, MongoDB and OpenRouter key.
- First-admin creation is tested directly rather than through Seam 2: there is no HTTP surface showing Users until ticket 08. Move the test then.
- The core now emits an `error` result when classification fails; ticket 03 extends this to the fallback list.
