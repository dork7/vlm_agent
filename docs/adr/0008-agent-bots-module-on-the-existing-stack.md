# Agent Bots as a module on the existing stack

Dataset-driven Telegram bots (real estate first) live in `src/agents/`, reusing MongoDB (ADR 0004), the OpenRouter model fallback list (ADR 0001) and the dashboard login, with grammY isolated to `src/agents/telegram.ts` as in ADR 0005.

- **Engine is channel-neutral.** `engine.ts` takes (bot, chat, text) and returns text plus Listings; only `telegram.ts` imports grammY. The LLM is an injectable function, so tests use a scripted one.
- **The model chooses filters, code searches.** `search_listings` runs over MongoDB and cards (price, payment, photos) are rendered from the Dataset row, so the model cannot invent prices. `book_appointment` only creates a `requested` Appointment.
- **Appointment state moves only in code.** requested -> confirmed | declined -> location-shared, by guarded atomic updates; only the linked Property Agent's button and location pin trigger them. The location sent is the pin the Property Agent shares, never Dataset coordinates.
- **Own LLM call, not `callTool`.** The existing `Llm` forces exactly one tool call; the conversation needs optional tool use over several rounds, so `agents/llm.ts` makes its own chat-completions call with the same fallback list.
- **One bot process, many grammY instances.** A manager runs one polling bot per enabled Agent Bot; token edits restart that bot, everything else is read from MongoDB per message so edits and re-imports apply without a restart.
- **Console auth is the dashboard's:** explicit credentials select a User; without them the first admin opens it, as the dashboard does.
- Images are local files under `dataset/images/`, served only from there (path-traversal guarded).
