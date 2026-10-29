export type ChatMessage =
  | { role: "system" | "user"; content: string }
  /** The model's earlier tool call, replayed so the conversation can continue. */
  | { role: "assistant"; content: null; tool_calls: Array<{ id: string; type: "function"; function: ToolCall }> }
  /** What running the tool call with this ID returned. */
  | { role: "tool"; tool_call_id: string; content: string };

export type Tool = {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
};

export type ToolCall = { name: string; arguments: string };

/** A tool call as the model made it, with the ID that its result must refer to. */
export type MadeToolCall = ToolCall & { id: string };

/** One try of one model from the fallback list, kept so it can be recorded on the Run. */
export type ModelAttempt =
  | { model: string; outcome: "succeeded" }
  | { model: string; outcome: "failed"; reason: string };

export type Llm = {
  /**
   * Asks each model in turn to answer by calling exactly one of the given tools, until one gives an
   * answer `read` accepts. `read` throws on an unusable answer, which moves on to the next model.
   */
  callTool<T>(request: { messages: ChatMessage[]; tools: Tool[]; read: (call: MadeToolCall) => T }): Promise<LlmAnswer<T>>;
};

export type LlmAnswer<T> = { value: T; attempts: ModelAttempt[] };

/** Every model in the fallback list failed. */
export class AllModelsFailedError extends Error {
  constructor(readonly attempts: ModelAttempt[]) {
    super(`Every model failed: ${attempts.map((attempt) => attempt.model).join(", ")}`);
  }
}

const REQUEST_TIMEOUT_MS = 60_000;

export function createOpenRouter(config: { apiKey: string; baseUrl: string; models: string[] }): Llm {
  if (config.models.length === 0) throw new Error("OpenRouter needs at least one model");

  const requestToolCall = async (model: string, messages: ChatMessage[], tools: Tool[]): Promise<MadeToolCall> => {
    const response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { authorization: `Bearer ${config.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({ model, messages, tools, tool_choice: "required" }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new Error(`OpenRouter ${model} responded ${response.status}: ${await response.text()}`);
    }

    const body = (await response.json()) as {
      choices?: Array<{ message?: { tool_calls?: Array<{ id?: string; function?: ToolCall }> } }>;
    };
    const made = body.choices?.[0]?.message?.tool_calls?.[0];
    const call = made?.function;
    if (!call?.name || typeof call.arguments !== "string") {
      throw new Error(`OpenRouter ${model} did not call a tool`);
    }
    return { id: made?.id || "call_0", name: call.name, arguments: call.arguments };
  };

  return {
    async callTool({ messages, tools, read }) {
      const attempts: ModelAttempt[] = [];
      for (const model of config.models) {
        try {
          const value = read(await requestToolCall(model, messages, tools));
          attempts.push({ model, outcome: "succeeded" });
          return { value, attempts };
        } catch (error) {
          attempts.push({ model, outcome: "failed", reason: error instanceof Error ? error.message : String(error) });
        }
      }
      throw new AllModelsFailedError(attempts);
    },
  };
}
