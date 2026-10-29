import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, afterEach, beforeAll } from "vitest";

type ScriptedResponse = { status: number; body: unknown };

export type FakeOpenRouter = {
  baseUrl: string;
  /** Queue a response for the next request made to this model. */
  script(model: string, response: ScriptedResponse): void;
  requests: Array<{ model: string; body: any }>;
};

/** A chat-completions response in which the model calls one tool with these arguments. */
export function toolCall(name: string, args: unknown): ScriptedResponse {
  return {
    status: 200,
    body: {
      choices: [
        {
          message: {
            role: "assistant",
            content: null,
            tool_calls: [
              { id: "call_1", type: "function", function: { name, arguments: JSON.stringify(args) } },
            ],
          },
          finish_reason: "tool_calls",
        },
      ],
    },
  };
}

/** A fake OpenRouter on a random local port, serving scripted responses per model. */
export function useFakeOpenRouter(): FakeOpenRouter {
  const queues = new Map<string, ScriptedResponse[]>();
  let server: Server;

  const fake: FakeOpenRouter = {
    baseUrl: "",
    script(model, response) {
      queues.set(model, [...(queues.get(model) ?? []), response]);
    },
    requests: [],
  };

  beforeAll(async () => {
    server = createServer(async (req, res) => {
      let raw = "";
      for await (const chunk of req) raw += chunk;
      const body = JSON.parse(raw);
      fake.requests.push({ model: body.model, body });

      const next = queues.get(body.model)?.shift() ?? {
        status: 500,
        body: { error: { message: `fake OpenRouter has nothing scripted for ${body.model}` } },
      };
      res.writeHead(next.status, { "content-type": "application/json" });
      res.end(JSON.stringify(next.body));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    fake.baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterEach(() => {
    queues.clear();
    fake.requests.length = 0;
  });

  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  return fake;
}
