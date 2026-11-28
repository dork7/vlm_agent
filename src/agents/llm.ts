import type { MadeToolCall, Tool } from "../llm/openrouter.ts";

export type AgentChatMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: Array<{ id: string; type: "function"; function: { name: string; arguments: string } }> }
  | { role: "tool"; tool_call_id: string; content: string };

export type AgentLlmRequest = { messages: AgentChatMessage[]; tools: Tool[]; model?: string; temperature?: number };
export type AgentLlmReply = { text: string | null; toolCalls: MadeToolCall[] };
/** The seam the engine talks to a model through; tests pass a scripted one. */
export type AgentLlm = (request: AgentLlmRequest) => Promise<AgentLlmReply>;

/**
 * A chat-completions model that may call tools or answer in text. Tries the persona's model first, then each model of the
 * OpenRouter fallback list (ADR 0001), until one answers.
 */
export function createAgentLlm(config: { apiKey: string; baseUrl: string; models: string[] }): AgentLlm {
  return async ({ messages, tools, model, temperature }) => {
    const models = [...(model ? [model] : []), ...config.models.filter((m) => m !== model)];
    const failures: string[] = [];
    for (const name of models) {
      try {
        const response = await fetch(`${config.baseUrl}/chat/completions`, {
          method: "POST",
          headers: { authorization: `Bearer ${config.apiKey}`, "content-type": "application/json" },
          body: JSON.stringify({ model: name, messages, tools, tool_choice: "auto", temperature: temperature ?? 0.3, max_tokens: 1024 }),
          signal: AbortSignal.timeout(60_000),
        });
        if (!response.ok) throw new Error(`responded ${response.status}: ${await response.text()}`);
        const body = (await response.json()) as { choices?: Array<{ message?: { content?: unknown; tool_calls?: Array<{ id?: string; function?: { name?: string; arguments?: string } }> } }> };
        const message = body.choices?.[0]?.message;
        const toolCalls = (message?.tool_calls ?? []).flatMap((c, i) => (c.function?.name ? [{ id: c.id || `call_${i}`, name: c.function.name, arguments: c.function.arguments ?? "{}" }] : []));
        const text = typeof message?.content === "string" && message.content.trim() ? message.content.trim() : null;
        if (!text && toolCalls.length === 0) throw new Error("gave no answer");
        return { text, toolCalls };
      } catch (error) {
        failures.push(`${name}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    throw new Error(`Every model failed. ${failures.join("; ")}`);
  };
}
