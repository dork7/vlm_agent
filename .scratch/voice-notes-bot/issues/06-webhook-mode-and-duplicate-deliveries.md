# 06: Webhook mode and duplicate deliveries

**What to build:** When configured with bot mode "webhook", the bot receives Telegram updates on a Fastify route instead of long polling, acknowledging each update immediately and processing it in the background (no job queue). A message delivered twice by a Channel (identified by Channel + chat + Channel message ID) is handled only once, in either mode.

**Blocked by:** 01

**Status:** ready-for-agent

- [x] The bot mode is chosen by configuration (polling or webhook); webhook mode requires the webhook URL and registers it with Telegram.
- [x] Through Seam 2, posting an update to the webhook route returns success immediately and hands the update to the adapter.
- [x] Through Seam 1, the same inbound message delivered twice produces one saved Note or Task and one result; the second delivery is ignored.
- [x] Deduplication state is stored in MongoDB so it survives a restart.

## Comments

- Config: `BOT_MODE` is `polling` (default) or `webhook`. Webhook mode needs `WEBHOOK_URL` (https; the route is served at its path) and `TELEGRAM_WEBHOOK_SECRET`, which Telegram sends back on every update so that nobody else can post fake updates claiming to be a User; the spec did not list the secret. `HOST` (default 127.0.0.1) lets the server listen where Telegram can reach it.
- On startup in webhook mode, the app calls `setWebhook` with the URL and secret. Polling mode's `bot.start` removes any registered webhook first. Stopping in webhook mode leaves the webhook registered, so Telegram holds updates until the bot is back.
- The route uses grammY's Fastify `webhookCallback`. The adapter handles each message in the background, so the route answers at once (tested with a core that has not finished); a wrong secret gets 401.
- Deduplication: `processedMessages` has a unique index on Channel + chat + Channel message ID. The core claims a message before anything else and ignores it, emitting nothing, when the claim already exists. This works across restarts and for two deliveries at once. `HandledMessage.duplicate` says when a delivery was ignored. Entries are never removed; ticket 12 may fold them into Runs.
- The test MongoDB helper now empties collections instead of dropping the database, so unique indexes stay in place between tests.
- Not checked against a real public URL; that needs a deployment or a tunnel.

