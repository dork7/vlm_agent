import type { Llm, Tool } from "../llm/openrouter.ts";

export type Classification = { kind: "note"; heading: string };

const SAVE_NOTE: Tool = {
  type: "function",
  function: {
    name: "save_note",
    description: "Save the message as a Note: something the person wants remembered for later reading.",
    parameters: {
      type: "object",
      properties: {
        heading: {
          type: "string",
          description: "A short line, under ten words, naming the most important point of the message.",
        },
      },
      required: ["heading"],
      additionalProperties: false,
    },
  },
};

const SYSTEM_PROMPT =
  "You file a person's messages. Read the message and call the tool that fits it.";

export async function classify(llm: Llm, transcript: string): Promise<Classification> {
  const call = await llm.callTool({
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: transcript },
    ],
    tools: [SAVE_NOTE],
  });
  if (call.name !== SAVE_NOTE.function.name) {
    throw new Error(`Model called unknown tool "${call.name}"`);
  }

  const args: unknown = JSON.parse(call.arguments);
  const heading =
    typeof args === "object" && args !== null && "heading" in args && typeof args.heading === "string"
      ? args.heading.trim()
      : "";
  if (!heading) throw new Error("Model returned a Note without a Heading");
  return { kind: "note", heading };
}
