# OpenRouter with an ordered model fallback list

The LLM is reached through OpenRouter using an owner-defined, ordered list of models rather than a single provider. When a model fails (request error, rate limit, timeout, or an unusable answer such as a malformed tool call), the next model in the list is tried, so one provider's outage or free-tier limit doesn't stop the bot. Every model in the list must support tool calling.
