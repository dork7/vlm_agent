import type { Item } from "./items.ts";

export type ItemFilters = { name?: string; category?: string; location?: string; lowStock?: boolean };

/** One of the two predefined Inventory tools the model may call (ADR 0002). */
export type InventoryLookup = { tool: "search_items"; filters: ItemFilters } | { tool: "get_item"; sku: string };

/** One HTTP request to the Inventory API, kept so it can be recorded on the Run. `status` is 0 when no response came. */
export type InventoryRequest = {
  tool: InventoryLookup["tool"];
  endpoint: string;
  status: number;
  latencyMs: number;
  error?: string;
};

/** What a lookup found; `items` is empty unless the request succeeded. */
export type LookupResult = { items: Item[]; request: InventoryRequest };

export type InventoryClient = { lookup(lookup: InventoryLookup): Promise<LookupResult> };

const REQUEST_TIMEOUT_MS = 10_000;

/** Reaches the Inventory API over HTTP at the configured base URL, so a real system can be swapped in. */
export function createInventoryClient(config: { baseUrl: string; apiKey: string }): InventoryClient {
  const base = new URL(config.baseUrl.endsWith("/") ? config.baseUrl : `${config.baseUrl}/`);

  return {
    async lookup(lookup) {
      const url = new URL(
        lookup.tool === "get_item" ? `items/${encodeURIComponent(lookup.sku)}` : `items?${searchParams(lookup.filters)}`,
        base,
      );
      const startedAt = performance.now();
      const request = (status: number, error?: string): InventoryRequest => ({
        tool: lookup.tool,
        endpoint: `${url.pathname}${url.search}`,
        status,
        latencyMs: Math.round(performance.now() - startedAt),
        ...(error === undefined ? {} : { error }),
      });

      let body: { items?: Item[]; item?: Item } = {};
      try {
        const response = await fetch(url, {
          headers: { "x-api-key": config.apiKey },
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
        if (!response.ok) {
          await response.body?.cancel();
          return { items: [], request: request(response.status) };
        }
        body = (await response.json()) as typeof body;
      } catch (error) {
        return { items: [], request: request(0, error instanceof Error ? error.message : String(error)) };
      }
      return { items: body.items ?? (body.item ? [body.item] : []), request: request(200) };
    },
  };
}

function searchParams(filters: ItemFilters): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.name !== undefined) params.set("name", filters.name);
  if (filters.category !== undefined) params.set("category", filters.category);
  if (filters.location !== undefined) params.set("location", filters.location);
  if (filters.lowStock) params.set("lowStock", "true");
  return params;
}
