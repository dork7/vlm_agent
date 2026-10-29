import type { InventoryClient } from "../../src/inventory/client.ts";
import type { Transcriber } from "../../src/transcriber/transcriber.ts";

/** For tests that make no Query: fails loudly if the core looks anything up. */
export const unusedInventory: InventoryClient = {
  async lookup() {
    throw new Error("This test did not expect an Inventory lookup");
  },
};

/** For tests that send only typed text: fails loudly if the core transcribes anything. */
export const unusedTranscriber: Transcriber = {
  model: "unused",
  async transcribe() {
    throw new Error("This test did not expect a transcription");
  },
};
