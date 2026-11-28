# End-to-end report: Agent Bots (ticket 08)

Date: 2026-11-28. Automated pass only: no real Telegram tokens and no real LLM were available.

## Method
`test/agents/e2e.test.ts` seeds the shipped sample (`dataset/`, via `seedSampleData`) into an in-memory MongoDB, builds the Fastify server with the `/agents` console, a bot manager and the real engine, with a scripted fake LLM and a grammY bot whose transport records every Bot API call. Also run: `npx tsc --noEmit` (clean) and `npx vitest run test/agents` (6 files, 21 tests pass).

## Checked (passing)
- Sample seeding: sample bot and "Sample listings" Dataset created on an empty database, mapping auto-detected, at least 12 rows, zero missing images, second seed is a no-op, bot guide is the shipped sample guide.
- Console: `/agents` lists the bot; Start marks it running (fake launch); Test chat returns listings; New link code shows on the bot page.
- Property Agent link: `/link CODE` from Telegram id 77 links it.
- Customer search (2 bed near marina): reply text plus a photo card whose caption carries the Dataset price `AED 9,800 / month` and `Yearly: AED 111,720`.
- Booking: `book_appointment` creates a `requested` Appointment, Property Agent gets a message with Confirm/Decline buttons and `agentNotifiedAt` is set.
- A stranger pressing Confirm is ignored; the Property Agent's Confirm moves it to `confirmed` and the Customer is told; the location pin sent as a reply to the prompt is relayed to the Customer (`sendLocation`) and the state becomes `location-shared`.
- Appointments console filter: `state=location-shared` lists it, `state=requested` does not. Chat logs filtered by chat show the customer text and the bot reply with the price.
- Existing unit tests for guarded transitions, double taps, expiring single-use link codes, import edge cases and console auth continue to pass.

## Could NOT be checked
- Live Telegram: real BotFather tokens, long polling, actual photo albums rendering, inline button UX, location pins on a phone.
- A real LLM through OpenRouter: model tool-calling quality, whether the guide is followed, the price-invention guard against real model output.
- The full app via `npm start`: it needs a valid `TELEGRAM_BOT_TOKEN` for the voice-notes bot and exits with "Telegram rejected TELEGRAM_BOT_TOKEN" with a fake one (expected, unrelated to agents), so `main.ts` wiring (`createAgents`, `startAll`, shutdown) was only checked by typecheck and by the in-process equivalent in the test.
- Browser rendering of the console pages (HTML was checked by content only).
- README step 2's "bad token shows an error" against real Telegram (covered by a unit test with a rejecting launch only).

## Failures and bugs
None found in `src/agents/`; no source changes were needed.

## Docs fixes
README now says the sample bot is seeded only when no bots exist, mentions `AGENT_SAMPLE_BOT_TOKEN`, and that booking is unavailable until a Property Agent is linked. Glossary, ADR 0008 and `.env.example` matched the code.

## README steps followed literally
1. Seeding: works. 2. Save token/Start: works with a fake launch. 3. Test chat: works. 4. Link code and booking: works. 5. Own dataset upload/mapping: covered by existing `http.test.ts`, not re-run through the browser.
