# 03: Model fallback list

**What to build:** The owner configures an ordered list of OpenRouter models (ADR 0001). When a model's request fails (rate limit, server error, timeout) or its answer is unusable (invalid JSON, unknown tool, missing required fields), the bot tries the next model. If every model fails, the User gets a clear "couldn't process this, please try again" reply. Each attempt (model, outcome, failure reason) is kept so ticket 12 can show it.

**Blocked by:** 01

**Status:** ready-for-agent

- [ ] The model list is read from configuration; startup fails clearly if it is empty.
- [ ] Through Seam 1 with a fake OpenRouter: a failing first model and a succeeding second model still produce the normal result.
- [ ] An unusable answer from the first model (e.g. malformed or missing required fields) also moves to the next model.
- [ ] When every model fails, the result is an error event and nothing is saved.
- [ ] Every attempt's model, outcome and failure reason is captured in a form ticket 12 can store on the Run.
