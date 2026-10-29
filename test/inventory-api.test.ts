import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildServer } from "../src/server.ts";
import { loadSeedItems, type Item } from "../src/inventory/items.ts";

const API_KEY = "inv-key";

const ITEMS: Item[] = [
  { sku: "SKU-01", name: "Blue mug", category: "Kitchen", quantity: 40, unitPrice: 6.5, location: "Warehouse A" },
  { sku: "SKU-02", name: "Red mug", category: "Kitchen", quantity: 4, unitPrice: 6.5, location: "Warehouse B" },
  { sku: "SKU-03", name: "Desk lamp", category: "Office", quantity: 3, unitPrice: 24, location: "Warehouse B" },
  { sku: "SKU-04", name: "Notebook", category: "Office", quantity: 120, unitPrice: 2.25, location: "Warehouse A" },
];

describe("Inventory API", () => {
  let server: FastifyInstance;

  beforeAll(async () => {
    server = buildServer({ logger: false, inventory: { items: ITEMS, apiKey: API_KEY } });
    await server.ready();
  });
  afterAll(() => server.close());

  const get = (url: string, apiKey: string | null = API_KEY) =>
    server.inject({ method: "GET", url, headers: apiKey === null ? {} : { "x-api-key": apiKey } });
  const skus = (response: { json(): { items: Item[] } }) => response.json().items.map((item) => item.sku);

  it("lists every item with no filters", async () => {
    const response = await get("/inventory/items");

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ items: ITEMS });
  });

  it("filters by part of the name, ignoring case", async () => {
    expect(skus(await get("/inventory/items?name=MUG"))).toEqual(["SKU-01", "SKU-02"]);
  });

  it("filters by category and by location, ignoring case", async () => {
    expect(skus(await get("/inventory/items?category=office"))).toEqual(["SKU-03", "SKU-04"]);
    expect(skus(await get("/inventory/items?location=warehouse%20b"))).toEqual(["SKU-02", "SKU-03"]);
  });

  it("filters to low stock: quantity below 10", async () => {
    expect(skus(await get("/inventory/items?lowStock=true"))).toEqual(["SKU-02", "SKU-03"]);
  });

  it("combines filters", async () => {
    expect(skus(await get("/inventory/items?name=mug&location=Warehouse%20B&lowStock=true"))).toEqual(["SKU-02"]);
    expect(skus(await get("/inventory/items?category=Kitchen&location=Warehouse%20A"))).toEqual(["SKU-01"]);
  });

  it("gets one item by SKU, or 404 when there is none", async () => {
    const found = await get("/inventory/items/SKU-03");
    expect(found.statusCode).toBe(200);
    expect(found.json()).toEqual({ item: ITEMS[2] });

    const missing = await get("/inventory/items/SKU-99");
    expect(missing.statusCode).toBe(404);
  });

  it("refuses requests without the correct API key", async () => {
    expect((await get("/inventory/items", null)).statusCode).toBe(401);
    expect((await get("/inventory/items", "wrong")).statusCode).toBe(401);
    expect((await get("/inventory/items/SKU-01", "wrong")).statusCode).toBe(401);
  });

  it("ships a seed file of about 25 items", () => {
    const seed = loadSeedItems();

    expect(seed.length).toBeGreaterThanOrEqual(20);
    expect(new Set(seed.map((item) => item.sku)).size).toBe(seed.length);
  });
});
