# Session: Agent Bots verification and tests (2026-11-28)

Task: Claude implemented the `src/agents/` module (tickets 01-12 of `.scratch/realestate-agent-bots/`). Codex writes and runs Vitest tests for it and reports bugs. Claude reads this file for the results.

## Brief for Codex
- Read `.scratch/realestate-agent-bots/spec.md` ("Testing Decisions") and the tickets in `.scratch/realestate-agent-bots/issues/`.
- Write tests ONLY under `test/agents/` (new files). Do NOT edit anything in `src/`. If you find a bug, record it below under "Findings" with file:line, a failing test name, and the expected behaviour. You may leave the failing test in place.
- Use existing helpers: `test/fakes/memory-mongo.ts` (`useMemoryMongo`), see `test/dashboard-notes.test.ts` for the `buildServer` + `inject` pattern.
- Cover: dataset import (CSV/JSON, malformed, unit-type normalisation, missing images, re-import replaces rows, search scoped to dataset); engine with a fake `AgentLlm` (tool loop, search results only from tool data, no-results alternatives, history isolated per bot/chat, `book_appointment` rejects past/bad dates and with no Property Agent linked); appointment state machine (double confirm, stranger pressing Confirm, invalid transitions, LLM cannot confirm); Property Agent link code (single-use, expiry); Telegram handlers via `installHandlers` with a grammY `Bot` whose `api.config.use(...)` transformer records calls and returns fake results, and `bot.botInfo` preset, feeding updates with `bot.handleUpdate` (confirm/decline, location relay incl. several pending, location before confirm not relayed, missing image falls back to text card); manager start with bad token -> error status without throwing; console HTTP (auth 503/401, create/edit validation keeps input, token masked, guide round trip, test chat + reset, logs scoped + paginated, appointments filter, dataset upload/mapping validation, image route blocks `..`); architecture: `src/agents/engine.ts` must not reach grammy.
- Run `npx vitest run test/agents` and `npx tsc --noEmit` (pre-existing TS errors about fastify-plugin / @fastify/websocket are known; ignore them).

## Findings
(Codex: append here)

## Status
(Codex: update here when finished)

### Codex findings — 2026-11-28

1. `src/agents/engine.ts:197-202` — `Agent engine > does not pass through invented listing prices from an LLM reply` (`test/agents/engine.test.ts:91`). The engine persists and returns arbitrary final LLM text even when no search tool ran. A fake model's “Marina studio is AED 999 per month” reaches the Customer, although that price is absent from the Dataset. Expected: listing and price claims in the reply must be grounded in tool results. This regression test is expected to fail once Mongo-backed tests can run.
2. `src/agents/telegram.ts:128-130` — `Telegram adapter > does not let this bot confirm another bot's appointment` (`test/agents/telegram.test.ts:76`). The callback validates the pressing Property Agent against the current bot but moves an Appointment by id without checking its `botId`. A Property Agent with a callback id from another bot can confirm that bot's Appointment and notify its Customer. Expected: a callback may affect only Appointments belonging to the receiving bot. This regression test is expected to fail once Mongo-backed tests can run.

### Codex status — 2026-11-28

Added 20 Vitest tests under `test/agents/` covering dataset CSV/JSON import and search, malformed data, image reports, re-import, engine tool loop/history/booking/state transitions, Telegram linking/callbacks/location/cards/manager errors, console auth/forms/chat/logs/appointments/dataset routes, and the no-grammY architecture check. No files in `src/` were edited.

- `npx tsc --noEmit`: passed.
- `npx vitest run test/agents/pure.test.ts`: 3 passed.
- `npx vitest run test/agents`: the four Mongo-backed suites cannot start in this sandbox because `mongodb-memory-server` gets `listen EPERM: operation not permitted 0.0.0.0`. All 17 integration tests were skipped by setup failure. Run the command in an environment that permits local port binding to confirm the two expected regressions and reveal any other failures.
