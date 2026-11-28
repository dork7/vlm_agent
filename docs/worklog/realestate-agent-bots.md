# Worklog: Dataset-driven Telegram agent bots

## 2026-11-26
- Brainstormed with the Owner. Decisions: LLM-guided Conversation Guide (.md), CSV/JSON dataset with local images, bots defined in the web console each with their own Telegram token.
- Wrote `.scratch/realestate-agent-bots/spec.md` and tickets `issues/01` to `08`, all ready-for-agent. No code written yet.
- Added Appointment flow (book, Property Agent confirm, location share) to the spec and tickets 09 to 12; ticket 08 now depends on them.
- Wrote sprint plan `.scratch/realestate-agent-bots/sprints.md` (3 sprints: core, operate and book, location and release).

## 2026-11-28
- Implemented tickets 01-12 in `src/agents/`: dataset import and search (`dataset.ts`, `csv.ts`, `unit-type.ts`), bot/appointment/message collections (`types.ts`), conversation engine with `search_listings` and `book_appointment` tools (`engine.ts`, `llm.ts`), Appointment state machine (`appointments.ts`), grammY manager, Listing cards, Property Agent link/confirm/decline and location relay (`telegram.ts`), the `/agents` console with test chat, chat logs, appointments and dataset UI (`http.ts`, `views/`), and sample data seeding (`sample.ts`, `dataset/`).
- Wired into `src/main.ts` and `src/server.ts`; added an Agents link to the dashboard nav.
- Delegated test writing and verification to Codex through `comms/2026-11-28-agent-bots-testing.md`.
- Docs: GLOSSARY entries, ADR 0008, README section, `.env.example`.
- Ticket 08: verified GLOSSARY, ADR 0008, README and `.env.example` against `src/agents/`; clarified README seeding and booking-before-link behaviour. Added `test/agents/e2e.test.ts` (sample bot, scripted LLM, recording Telegram transport, console views) and wrote `.scratch/realestate-agent-bots/report.md`. Live Telegram and a real LLM were not available and are recorded as unchecked.
