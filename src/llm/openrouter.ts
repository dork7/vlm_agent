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

/** Tokens a model used, as OpenRouter reported them. */
export type TokenUsage = { prompt: number; completion: number; total: number };

/**
 * One try of one model from the fallback list, kept so it can be recorded on the Run.
 * `tokens` and `cost` (in US dollars) are present only when the model responded and OpenRouter reported them.
 */
export type ModelAttempt = (
  | { model: string; outcome: "succeeded" }
  | { model: string; outcome: "failed"; reason: string }
) & { tokens?: TokenUsage; cost?: number };

/** What OpenRouter reported a response cost. */
type Usage = { tokens?: TokenUsage; cost?: number };

/** OpenRouter's `usage` field, as it arrives: any of it may be missing or not a number. */
type ReportedUsage = { prompt_tokens?: unknown; completion_tokens?: unknown; total_tokens?: unknown; cost?: unknown };

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
/**
 * Room for one tool call. Without a cap OpenRouter reserves the model's whole output length against the
 * account balance, so a small balance refuses every request.
 */
const MAX_ANSWER_TOKENS = 1024;
/** A local model may first have to load, which takes longer than a hosted one answering. */
const LOCAL_REQUEST_TIMEOUT_MS = 180_000;
/** Local models whose names say they can't chat: embedding, audio, speech and image models. */
const NOT_CHAT = /embed|rerank|audio|whisper|tts|diffusion|flux/i;

/** An OpenAI-compatible chat-completions server. */
type Endpoint = { name: string; baseUrl: string; apiKey?: string; timeoutMs: number };

/**
 * Tries each model in `models` on OpenRouter, then, with `local`, every chat model an OpenAI-compatible
 * server on this machine lists (such as LocalAI), recorded as `local/<model>`.
 */
export function createOpenRouter(config: {
  apiKey: string;
  baseUrl: string;
  models: string[];
  local?: { baseUrl: string } | undefined;
}): Llm {
  if (config.models.length === 0) throw new Error("OpenRouter needs at least one model");
  const openRouter: Endpoint = { name: "OpenRouter", baseUrl: config.baseUrl, apiKey: config.apiKey, timeoutMs: REQUEST_TIMEOUT_MS };

  /** `usage` is filled in as soon as the response arrives, so it is known even when the answer is unusable. */
  const requestToolCall = async (
    endpoint: Endpoint,
    model: string,
    messages: ChatMessage[],
    tools: Tool[],
    usage: Usage,
  ): Promise<MadeToolCall> => {
    const response = await fetch(`${endpoint.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        ...(endpoint.apiKey ? { authorization: `Bearer ${endpoint.apiKey}` } : {}),
        "content-type": "application/json",
      },
      body: JSON.stringify({ model, messages, tools, tool_choice: "required", max_tokens: MAX_ANSWER_TOKENS }),
      signal: AbortSignal.timeout(endpoint.timeoutMs),
    });
    if (!response.ok) {
      throw new Error(`${endpoint.name} ${model} responded ${response.status}: ${await response.text()}`);
    }

    const body = (await response.json()) as {
      choices?: Array<{ message?: { tool_calls?: Array<{ id?: string; function?: ToolCall }> } }>;
      usage?: ReportedUsage;
    };
    Object.assign(usage, readUsage(body.usage));
    const made = body.choices?.[0]?.message?.tool_calls?.[0];
    const call = made?.function;
    if (!call?.name || typeof call.arguments !== "string") {
      throw new Error(`${endpoint.name} ${model} did not call a tool`);
    }
    return { id: made?.id || "call_0", name: call.name, arguments: call.arguments };
  };

  return {
    async callTool({ messages, tools, read }) {
      const attempts: ModelAttempt[] = [];
      /** Tries one model, recording the attempt as `label`; the answer, or undefined when it failed. */
      const attempt = async (endpoint: Endpoint, model: string, label: string) => {
        const usage: Usage = {};
        try {
          const value = read(await requestToolCall(endpoint, model, messages, tools, usage));
          attempts.push({ model: label, outcome: "succeeded", ...usage });
          return { value };
        } catch (error) {
          attempts.push({ model: label, outcome: "failed", reason: errorText(error), ...usage });
          return undefined;
        }
      };

      for (const model of config.models) {
        const answer = await attempt(openRouter, model, model);
        if (answer) return { value: answer.value, attempts };
      }

      if (config.local) {
        const local: Endpoint = { name: "Local model server", baseUrl: config.local.baseUrl, timeoutMs: LOCAL_REQUEST_TIMEOUT_MS };
        let models: string[] = [];
        try {
          models = (await listModels(local)).filter((model) => !NOT_CHAT.test(model));
        } catch (error) {
          attempts.push({ model: "local", outcome: "failed", reason: errorText(error) });
        }
        for (const model of models) {
          const answer = await attempt(local, model, `local/${model}`);
          if (answer) return { value: answer.value, attempts };
        }
      }
      throw new AllModelsFailedError(attempts);
    },
  };
}

/** Whether an attempt's model is one of the local server's, rather than OpenRouter's. */
export function isLocalModel(attemptModel: string): boolean {
  return attemptModel === "local" || attemptModel.startsWith("local/");
}

/** The model IDs an OpenAI-compatible server lists at `GET /models`. */
async function listModels(endpoint: Endpoint): Promise<string[]> {
  const response = await fetch(`${endpoint.baseUrl}/models`, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`${endpoint.name} listing models responded ${response.status}: ${await response.text()}`);
  const body = (await response.json()) as { data?: Array<{ id?: unknown }> };
  return (body.data ?? []).flatMap((model) => (typeof model.id === "string" ? [model.id] : []));
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function readUsage(usage: ReportedUsage | undefined): Usage {
  if (!usage) return {};
  const { prompt_tokens: prompt, completion_tokens: completion, total_tokens: total, cost } = usage;
  return {
    ...(typeof prompt === "number" && typeof completion === "number" && typeof total === "number"
      ? { tokens: { prompt, completion, total } }
      : {}),
    ...(typeof cost === "number" ? { cost } : {}),
  };
}
