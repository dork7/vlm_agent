# 03: Channel-neutral conversation engine with LLM tools

**What to build:** Build the engine: given (bot, chat id, text) build the system prompt from Persona + Conversation Guide + Dataset schema, run an LLM tool-calling loop (injectable LLM function, OpenRouter fallback list) with `search_listings` as the only data tool, persist per-chat history in MongoDB, return reply text plus Listing ids. Handles no-results alternatives and follow-ups ("cheaper"). No grammY imports. Spec stories 11–15.

**Blocked by:** 01, 02

**Status:** done

- [ ] Prices and payment options in replies come only from tool results.
- [ ] Bot asks for missing location / unit type per the Guide.
- [ ] Empty results produce a suggestion, not an invented listing.
- [ ] History persists across messages in a chat and is isolated per bot and chat.
- [ ] Covered by tests with a fake LLM; architecture test confirms no channel imports.
