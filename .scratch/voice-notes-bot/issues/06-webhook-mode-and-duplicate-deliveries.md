# 06: Webhook mode and duplicate deliveries

**What to build:** When configured with bot mode "webhook", the bot receives Telegram updates on a Fastify route instead of long polling, acknowledging each update immediately and processing it in the background (no job queue). A message delivered twice by a Channel (identified by Channel + chat + Channel message ID) is handled only once, in either mode.

**Blocked by:** 01

**Status:** ready-for-agent

- [ ] The bot mode is chosen by configuration (polling or webhook); webhook mode requires the webhook URL and registers it with Telegram.
- [ ] Through Seam 2, posting an update to the webhook route returns success immediately and hands the update to the adapter.
- [ ] Through Seam 1, the same inbound message delivered twice produces one saved Note or Task and one result; the second delivery is ignored.
- [ ] Deduplication state is stored in MongoDB so it survives a restart.
