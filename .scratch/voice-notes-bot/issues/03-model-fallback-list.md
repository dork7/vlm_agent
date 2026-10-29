# 03: Model fallback list

**What to build:** The owner configures an ordered list of OpenRouter models (ADR 0001). When a model's request fails (rate limit, server error, timeout) or its answer is unusable (invalid JSON, unknown tool, missing required fields), the bot tries the next model. If every model fails, the User gets a clear "couldn't process this, please try again" reply. Each attempt (model, outcome, failure reason) is kept so ticket 12 can show it.

**Blocked by:** 01

**Status:** ready-for-agent

- [x] The model list is read from configuration; startup fails clearly if it is empty.
- [x] Through Seam 1 with a fake OpenRouter: a failing first model and a succeeding second model still produce the normal result.
- [x] An unusable answer from the first model (e.g. malformed or missing required fields) also moves to the next model.
- [x] When every model fails, the result is an error event and nothing is saved.
- [x] Every attempt's model, outcome and failure reason is captured in a form ticket 12 can store on the Run.

## Comments

- Implemented in `src/llm/openrouter.ts`: `callTool` takes a `read` function that turns the tool call into a value and throws on an unusable answer, so request errors, timeouts and unusable answers all move on to the next model. `AllModelsFailedError` carries every attempt.
- `core.handleMessage` now resolves to `{ modelAttempts }` (model, outcome, failure reason) for ticket 12 to store on the Run. Tokens and cost are not captured yet; ticket 12 will need to extend `ModelAttempt`.
- Tests: `test/model-fallback.test.ts` (Seam 1). There is no test for a hung request; the 60 s timeout's rejection is caught by the same per-model `try` as other request errors.
- The Telegram failure reply now reads "Sorry, I couldn't process that. Please try again."
