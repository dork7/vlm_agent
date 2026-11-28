# Spec: Dataset-driven Telegram agent bots (real estate first)

Status: needs-triage (awaiting Owner review)

Builds on ADR 0005 (channel-neutral core with adapters), ADR 0001 (OpenRouter model fallback list) and ADR 0004 (MongoDB). Implementation tickets: `issues/01` to `12`. Design agreed in chat on 2026-11-26.

## Problem Statement

A real estate agent wants customers to find homes by chatting on Telegram. Today the repo has only the voice-notes bot. There is no way to point a bot at a dataset, describe in plain Markdown how it should talk, or run several differently-behaved bots.

## Solution

A new `src/agents/` module. An operator creates **Agent Bots** in a web console. Each has its own Telegram token, **Dataset**, **Conversation Guide** (a Markdown file) and **Persona**. Customers chat with the bot on Telegram. An LLM follows the Conversation Guide, asks for location and unit type (1BHK, 2BHK, studio), searches the Dataset through a code-executed tool, and replies with photos, price and payment options (monthly, yearly). Everything shown comes from the Dataset; the LLM never invents prices or listings.

## Decisions

- **Conversation Guide is LLM-guided** (not a rigid script). It describes persona, what to ask and the reply format. The LLM follows it freely and handles typos and off-script messages.
- **Dataset** is CSV or JSON in `dataset/`, field names arbitrary. Images are local files in `dataset/images/` (referenced by relative path in a field). The bot config maps roles to fields: `location`, `unit_type`, `price`, `images`, `payment`.
- **Bots are defined in the web console**, stored in MongoDB, each a live grammY bot (polling) inside the one app, with start/stop and hot reload.
- **Search is structured**: `search_listings(filters)` runs in code over MongoDB; the model only chooses filters.
- Web console lives under `/agents`, behind the existing dashboard login.
- **Appointments:** once a Customer shows interest in a Listing the bot offers to schedule a viewing. The LLM collects a date/time through a `book_appointment` tool (executed in code). Flow: **requested** (Customer asks) -> Property Agent is messaged on Telegram with Confirm / Decline buttons -> **confirmed** (or **declined**, Customer told) -> bot asks the Property Agent to share the apartment's location -> Property Agent sends a Telegram location pin -> bot relays it to the Customer (**location-shared**). The Customer is told at each step.
- **Property Agent** is a person linked to a bot (Telegram ID set in the console, linked by a one-time code sent to the bot). A bot has one Property Agent; routing by Listing owner is future work.
- The location shared is the one the Property Agent sends, not coordinates from the Dataset, so it is never auto-revealed before confirmation.
- Out of scope: reminders, rescheduling, calendar sync, payment processing, WhatsApp (adapter seam leaves room), vector/RAG search, multi-tenant accounts.

## Glossary additions (to land in `GLOSSARY.md`)

- **Agent Bot**: a configured, runnable Telegram bot; avoid "agent", "chatbot".
- **Dataset**: the imported rows an Agent Bot answers from; avoid "database", "inventory" (Inventory already means something else).
- **Listing**: one Dataset row shown to a customer.
- **Conversation Guide**: the Markdown file describing how an Agent Bot talks.
- **Persona**: an Agent Bot's tone, language, model and limits.
- **Customer**: the person chatting with an Agent Bot (not a User).
- **Property Agent**: the person who hosts viewings for an Agent Bot and confirms Appointments; avoid "agent" alone.
- **Appointment**: a Customer's requested viewing of one Listing at a date/time, with a state (requested, confirmed, declined, location-shared).

## User Stories

### Datasets
1. As an operator, I want to upload a CSV or JSON file and see a preview of its rows and detected fields, so that I know it was read correctly.
2. As an operator, I want to map which field is location, unit type, price, images and payment, so that any dataset layout works.
3. As an operator, I want local image files in `dataset/images/` matched to rows, with missing images reported, so that broken photos are caught before customers see them.
4. As an operator, I want to re-import a Dataset after editing it, so that bots use fresh data without restart.

### Agent Bots
5. As an operator, I want to create a bot with a name, Telegram token, Dataset, Persona and Conversation Guide, so that each bot behaves as I define.
6. As an operator, I want to edit the Conversation Guide in the console as Markdown, so that I change behaviour without touching files or restarting.
7. As an operator, I want to set Persona characteristics (tone, language, model, temperature, max results per reply), so that bots differ.
8. As an operator, I want to start and stop each bot, and see a clear error for a bad token, so that I know what is running.
9. As an operator, I want a test chat box in the console, so that I can try a bot without Telegram.
10. As an operator, I want to read each bot's chats, so that I can see how customers are served.

### Customer on Telegram
11. As a Customer, I want the bot to ask where I want a home and whether I want a 1BHK, 2BHK or studio, so that results fit me.
12. As a Customer, I want to answer in free text ("2 bed near marina"), so that I'm not forced through buttons.
13. As a Customer, I want matching Listings with photos, price and payment options (monthly, yearly), so that I can compare.
14. As a Customer, I want sensible alternatives when nothing matches, so that I'm not left at a dead end.
15. As a Customer, I want the bot to remember my answers during the chat, so that I can refine ("cheaper", "show more").

### Appointments
16. As a Customer, once I like a property, I want the bot to offer to schedule a viewing, so that I can see it.
17. As a Customer, I want to give a date and time in free text, so that booking is easy.
18. As a Customer, I want to be told my request is waiting for the Property Agent, then told when it is confirmed or declined, so that I know where I stand.
19. As a Property Agent, I want a Telegram message with the Customer, Listing and time and Confirm / Decline buttons, so that I can answer in one tap.
20. As a Property Agent, after I confirm, I want to be asked to share the apartment's location, so that I send the right pin.
21. As a Property Agent, I want my location pin passed to the Customer, so that they can find the apartment.
22. As an operator, I want to link a Property Agent to a bot and see all Appointments with their state in the console, so that I can follow up.

## Implementation Decisions

- Appointments are stored with a state machine (requested -> confirmed | declined -> location-shared); only the Property Agent's Confirm/Decline and location messages move it, never the LLM. Invalid transitions and double-taps are ignored. Customer and Property Agent messages go through the same Telegram adapter; the engine stays channel-neutral.
- Collections: `appointments`, `agentBots`, `datasets`, `datasetRows` (rows tagged with dataset id), `agentChats`/`agentMessages`.
- Engine is channel-neutral: takes (bot, chat id, text), returns text plus Listing ids; the Telegram adapter renders photo albums with captions (price and monthly/yearly lines). It never imports grammY.
- System prompt = Persona + Conversation Guide + Dataset schema/field mapping + tool rules. LLM via the existing OpenRouter fallback list.
- Tokens are stored server-side and never rendered back to the browser in full.
- Test seams: the engine takes an injectable LLM function; Telegram is behind the adapter; MongoDB via `mongodb-memory-server`.

## Testing Decisions

Vitest through the engine and HTTP seams with a fake LLM. Test the Appointment state machine (including double Confirm and a stranger pressing Confirm), the Property Agent linking code, and location relay. Test search filtering and price/payment fidelity from the Dataset, the "no results" path, import edge cases (missing images, bad CSV) and console auth. A manual end-to-end pass uses the shipped sample real estate Dataset.

## Further Notes

AGENTS.md requires a worklog file for this feature: `docs/worklog/realestate-agent-bots.md`.
