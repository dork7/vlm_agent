import type { InventoryClient } from "../../src/inventory/client.ts";

/** For tests that make no Query: fails loudly if the core looks anything up. */
export const unusedInventory: InventoryClient = {
  async lookup() {
    throw new Error("This test did not expect an Inventory lookup");
  },
};
