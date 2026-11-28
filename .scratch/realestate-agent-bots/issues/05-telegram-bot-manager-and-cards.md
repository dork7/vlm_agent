# 05: Telegram bot manager and Listing cards

**What to build:** Add a manager that runs one grammY bot per Agent Bot (polling), with start/stop from the console, hot reload on edit, and token validation with a visible error. Add the Telegram adapter: each result is sent as a photo album with caption (location, unit type, price, monthly/yearly payment) plus the LLM reply, uploading local images. Spec stories 8, 13.

**Blocked by:** 03

**Status:** done

- [ ] Starting a bot with a bad token shows an error in the console and does not crash the app.
- [ ] Editing a running bot applies without restarting the app.
- [ ] Stopped bots stop answering.
- [ ] Missing image falls back to a text-only card.
- [ ] Adapter covered by tests with a fake Telegram client.
