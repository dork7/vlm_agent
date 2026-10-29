export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

export type Tool = {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
};

export type ToolCall = { name: string; arguments: string };

export type Llm = {
  /** Asks the model to answer by calling exactly one of the given tools. */
  callTool(request: { messages: ChatMessage[]; tools: Tool[] }): Promise<ToolCall>;
};

export function createOpenRouter(config: { apiKey: string; baseUrl: string; models: string[] }): Llm {
  // The fallback list arrives in a later ticket; for now only the first model is used.
  const model = config.models[0];
  if (!model) throw new Error("OpenRouter needs at least one model");

  return {
    async callTool({ messages, tools }) {
      const response = await fetch(`${config.baseUrl}/chat/completions`, {
        method: "POST",
        headers: { authorization: `Bearer ${config.apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({ model, messages, tools, tool_choice: "required" }),
        signal: AbortSignal.timeout(60_000),
      });
      if (!response.ok) {
        throw new Error(`OpenRouter ${model} responded ${response.status}: ${await response.text()}`);
      }

      const body = (await response.json()) as {
        choices?: Array<{ message?: { tool_calls?: Array<{ function?: ToolCall }> } }>;
      };
      const call = body.choices?.[0]?.message?.tool_calls?.[0]?.function;
      if (!call?.name || typeof call.arguments !== "string") {
        throw new Error(`OpenRouter ${model} did not call a tool`);
      }
      return { name: call.name, arguments: call.arguments };
    },
  };
}
