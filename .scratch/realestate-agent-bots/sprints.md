# Sprint plan: Dataset-driven Telegram agent bots

Spec: [spec.md](spec.md). Tickets: `issues/01` to `12`.
Sprint length and capacity are assumptions (about one week each, one developer plus an AFK agent). Resize if wrong; only the dependency order is fixed.

## Sprint 1: A bot that answers from a dataset (core)

**Goal:** an operator creates a bot in the web console, and a customer on Telegram asks for a home and gets matching listings with photos, price and payment options.

| Order | Ticket | Notes |
|---|---|---|
| 1 | 01 Dataset import and search | Start here; unblocks everything |
| 2 | 02 Bot definitions and console CRUD | |
| 3 | 03 Conversation engine | Riskiest piece (prompting + tool loop); do early |
| 4 | 05 Telegram manager and cards | Can run in parallel with 04 |
| 4 | 04 Test chat in the console | Lets you test without Telegram |

**Demo:** create a bot with the sample guide, chat on Telegram and in the test chat, get listing cards.
**Exit:** tickets 01–05 done; price/payment fidelity tests pass.

## Sprint 2: Operate it, and book viewings

**Goal:** the operator manages data and watches conversations; customers can request a viewing and the property agent confirms.

| Order | Ticket | Notes |
|---|---|---|
| 1 | 06 Dataset upload, preview and mapping UI | |
| 1 | 07 Chat logs | Parallel with 06 |
| 2 | 09 Appointment request and state machine | |
| 3 | 10 Property Agent link and Confirm/Decline | Needs 05 and 09 |

**Demo:** upload a dataset in the UI, book a viewing from Telegram, property agent taps Confirm, customer is notified.
**Exit:** tickets 06, 07, 09, 10 done; state-machine tests cover double-tap and stranger-press.

## Sprint 3: Location, visibility, release

**Goal:** the full flow ends with the location pin; the system is documented and verified end to end.

| Order | Ticket | Notes |
|---|---|---|
| 1 | 11 Location share relay | |
| 1 | 12 Appointments console | Parallel with 11 |
| 2 | 08 Sample data, docs and end-to-end pass | Last: covers everything, writes the report |

**Demo:** full journey: ask, browse, book, confirm, location pin. The README gets a new operator to a working bot.
**Exit:** all 12 tickets done; `report.md` written; glossary, ADR and worklog updated.

## Risks to watch

- **LLM tool-calling reliability** across the fallback models (Sprint 1): decide early which model is the default and test the fallback ones.
- **Free-text date parsing** in ticket 09: pin the timezone behaviour (bot's timezone, from `DEFAULT_TIMEZONE`) before building.
- **One Property Agent per bot** is an assumption; confirm before Sprint 2.
