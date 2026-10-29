import { readFileSync } from "node:fs";

/** One item in the Inventory. */
export type Item = {
  sku: string;
  name: string;
  category: string;
  quantity: number;
  unitPrice: number;
  location: string;
};

/** An item is low on stock when its quantity is below this. */
export const LOW_STOCK_THRESHOLD = 10;

/** The dummy Inventory's sample items, kept in memory and never stored in MongoDB. */
export function loadSeedItems(): Item[] {
  return JSON.parse(readFileSync(new URL("./seed.json", import.meta.url), "utf8")) as Item[];
}
