import type { FastifyInstance } from "fastify";
import { LOW_STOCK_THRESHOLD, type Item } from "./items.ts";

export type InventoryApiOptions = { items: Item[]; apiKey: string };

type ItemsQuerystring = { name?: string; category?: string; location?: string; lowStock?: string };

/** The dummy, read-only Inventory API under /inventory, protected by an API key in the x-api-key header. */
export async function inventoryRoutes(server: FastifyInstance, { items, apiKey }: InventoryApiOptions) {
  server.addHook("onRequest", async (request, reply) => {
    if (request.headers["x-api-key"] !== apiKey) {
      return reply.code(401).send({ error: "Missing or wrong API key" });
    }
  });

  server.get<{ Querystring: ItemsQuerystring }>("/items", async (request) => {
    const { name, category, location, lowStock } = request.query;
    return {
      items: items.filter(
        (item) =>
          (name === undefined || item.name.toLowerCase().includes(name.toLowerCase())) &&
          (category === undefined || sameText(item.category, category)) &&
          (location === undefined || sameText(item.location, location)) &&
          (lowStock !== "true" || item.quantity < LOW_STOCK_THRESHOLD),
      ),
    };
  });

  server.get<{ Params: { sku: string } }>("/items/:sku", async (request, reply) => {
    const item = items.find((candidate) => sameText(candidate.sku, request.params.sku));
    if (!item) return reply.code(404).send({ error: `No item with SKU ${request.params.sku}` });
    return { item };
  });
}

function sameText(a: string, b: string): boolean {
  return a.toLowerCase() === b.trim().toLowerCase();
}
