# vlm_agent

Voice Notes Bot: turns messages sent to a bot into Notes (and later Tasks and Inventory answers). See `.scratch/voice-notes-bot/spec.md`, `GLOSSARY.md` and `docs/adr/`.

## Running it

Requires Node.js 22+.

```sh
npm install          # install
npm run typecheck    # typecheck
npm test             # test suite (downloads a MongoDB binary on first run)
cp .env.example .env # then fill it in
npm start            # start the app (Telegram long polling + Fastify)
```

Startup fails with a message naming any missing required environment variable. With no Users in the database, it creates the first admin from `ADMIN_USERNAME`, `ADMIN_PASSWORD` and `ADMIN_TELEGRAM_ID` (your numeric Telegram user ID).
