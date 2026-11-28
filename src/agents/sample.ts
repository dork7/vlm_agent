import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import { DatasetError, importDataset } from "./dataset.ts";
import { DEFAULT_PERSONA, type AgentsStore } from "./types.ts";

export const SAMPLE_FILE = "sample-listings.csv";
const SAMPLE_BOT_NAME = "Sample Real Estate Bot";
/** Never a valid token: the operator replaces it in the console before starting the bot. */
const PLACEHOLDER_TOKEN = "000000:replace-me-in-the-console";

/**
 * On a fresh database, imports the shipped sample Dataset and adds a ready-to-edit sample bot with the example Conversation Guide.
 * Does nothing when there are already bots, or when the sample files are not there.
 */
export async function seedSampleData(store: AgentsStore, datasetDir: string, env: NodeJS.ProcessEnv = process.env): Promise<void> {
  if ((await store.bots.estimatedDocumentCount()) > 0) return;
  if (!(await access(join(datasetDir, SAMPLE_FILE)).then(() => true, () => false))) return;
  const guide = await readFile(join(datasetDir, "sample-guide.md"), "utf8").catch(() => "");
  try {
    const dataset = await importDataset({ store, datasetDir, sourceFile: SAMPLE_FILE, name: "Sample listings" });
    const at = new Date();
    await store.bots.insertOne({
      name: SAMPLE_BOT_NAME, token: env.AGENT_SAMPLE_BOT_TOKEN?.trim() || PLACEHOLDER_TOKEN, datasetId: dataset.mapping ? dataset._id : null,
      persona: { ...DEFAULT_PERSONA }, guide, enabled: false,
      propertyAgent: { telegramId: null, name: null, linkCode: null, linkCodeExpiresAt: null }, createdAt: at, updatedAt: at,
    });
  } catch (error) {
    if (!(error instanceof DatasetError)) throw error;
  }
}
