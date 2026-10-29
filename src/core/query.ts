import type { InventoryClient, InventoryLookup, ItemFilters } from "../inventory/client.ts";
import type { ChatMessage, Llm, MadeToolCall, Tool } from "../llm/openrouter.ts";
import { optionalString, requiredString, toolArguments } from "./tool-arguments.ts";

export const SEARCH_ITEMS: Tool = {
  type: "function",
  function: {
    name: "search_items",
    description:
      "Search the Inventory. Every filter is optional; give only those the person mentioned. " +
      "With no filters, every item is returned.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "Part of the item's name, such as \"mug\"." },
        category: { type: "string", description: "The item's category, such as \"Kitchen\"." },
        location: { type: "string", description: "Where the item is kept, such as \"Warehouse B\"." },
        low_stock: { type: "boolean", description: "true to return only items that are running low." },
      },
      additionalProperties: false,
    },
  },
};

export const GET_ITEM: Tool = {
  type: "function",
  function: {
    name: "get_item",
    description: "Get one Inventory item by its SKU, such as \"SKU-12\".",
    parameters: {
      type: "object",
      properties: { sku: { type: "string", description: "The item's SKU." } },
      required: ["sku"],
      additionalProperties: false,
    },
  },
};

const ANSWER_QUERY: Tool = {
  type: "function",
  function: {
    name: "answer_query",
    description:
      "Answer the person's Query in plain language, using only the Inventory results above. " +
      "If nothing matched, say so plainly.",
    parameters: {
      type: "object",
      properties: { answer: { type: "string", description: "A short, plain-language answer." } },
      required: ["answer"],
      additionalProperties: false,
    },
  },
};

/** The most lookups one Query may make before the model must answer with what it has. */
const MAX_LOOKUPS = 4;

export const NOTHING_MATCHED = "No items matched.";

/** The model's call to one of the two Inventory tools, and the lookup it asks for. */
export type InventoryToolCall = { call: MadeToolCall; lookup: InventoryLookup };

export function isInventoryToolCall(call: MadeToolCall): boolean {
  return call.name === SEARCH_ITEMS.function.name || call.name === GET_ITEM.function.name;
}

/** Throws on an unusable search_items or get_item call. */
export function readInventoryToolCall(call: MadeToolCall): InventoryToolCall {
  return { call, lookup: readLookup(call) };
}

function readLookup(call: MadeToolCall): InventoryLookup {
  const args = toolArguments(call.arguments);
  if (call.name === GET_ITEM.function.name) return { tool: "get_item", sku: requiredString(args, "sku") };

  const filters: ItemFilters = {};
  const name = optionalString(args, "name");
  const category = optionalString(args, "category");
  const location = optionalString(args, "location");
  if (name !== undefined) filters.name = name;
  if (category !== undefined) filters.category = category;
  if (location !== undefined) filters.location = location;
  const lowStock = args.low_stock;
  if (lowStock !== undefined && lowStock !== null) {
    if (typeof lowStock !== "boolean") throw new Error('Model gave a non-boolean "low_stock"');
    filters.lowStock = lowStock;
  }
  return { tool: "search_items", filters };
}

/**
 * Runs the model's Inventory lookups over HTTP, feeding each result back to it, until it answers.
 * `conversation` ends with the message the first lookup came from.
 */
export async function answerQuery(deps: {
  llm: Llm;
  inventory: InventoryClient;
  conversation: ChatMessage[];
  first: InventoryToolCall;
}): Promise<string> {
  const { llm, inventory } = deps;
  const conversation = [...deps.conversation];
  let next: InventoryToolCall = deps.first;

  for (let lookups = 1; ; lookups++) {
    const { items, request } = await inventory.lookup(next.lookup);
    if (request.status !== 200 && request.status !== 404) {
      throw new Error(`Inventory API responded ${request.status} to ${request.endpoint}`);
    }
    conversation.push(
      { role: "assistant", content: null, tool_calls: [{ id: next.call.id, type: "function", function: next.call }] },
      {
        role: "tool",
        tool_call_id: next.call.id,
        content: items.length === 0 ? NOTHING_MATCHED : JSON.stringify(next.lookup.tool === "get_item" ? items[0] : { items }),
      },
    );

    const mayLookUp = lookups < MAX_LOOKUPS;
    const { value } = await llm.callTool({
      messages: conversation,
      tools: mayLookUp ? [SEARCH_ITEMS, GET_ITEM, ANSWER_QUERY] : [ANSWER_QUERY],
      read: (call) => readStep(call, mayLookUp),
    });
    if ("answer" in value) return value.answer;
    next = value;
  }
}

/** Throws on an unusable answer, including a lookup once no more are allowed. */
function readStep(call: MadeToolCall, mayLookUp: boolean): { answer: string } | InventoryToolCall {
  if (call.name === ANSWER_QUERY.function.name) {
    return { answer: requiredString(toolArguments(call.arguments), "answer") };
  }
  if (mayLookUp && isInventoryToolCall(call)) return readInventoryToolCall(call);
  throw new Error(`Model called unknown tool "${call.name}"`);
}
