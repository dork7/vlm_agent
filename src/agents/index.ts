import type { Database } from "./../db.ts";
import { createEngine } from "./engine.ts";
import { createAgentLlm, type AgentLlm } from "./llm.ts";
import { createBotManager } from "./telegram.ts";
import { createAgentsStore, ensureAgentsIndexes } from "./types.ts";
import { seedSampleData } from "./sample.ts";
import type { AgentsOptions } from "./http.ts";

/** Builds the Agent Bots module: its store, engine, Telegram manager and the options for the `/agents` console. */
export async function createAgents(options: {
  database: Database;
  openRouter: { apiKey: string; baseUrl: string; models: string[] };
  defaultTimezone: string;
  datasetDir: string;
  llm?: AgentLlm;
}) {
  const store = createAgentsStore(options.database.db);
  await ensureAgentsIndexes(store);
  const manager: { current?: ReturnType<typeof createBotManager> } = {};
  const engine = createEngine({
    store,
    llm: options.llm ?? createAgentLlm(options.openRouter),
    defaultTimezone: options.defaultTimezone,
    hooks: { appointmentRequested: (appointment, bot) => manager.current?.notifyAppointment(appointment, bot) ?? Promise.resolve() },
  });
  manager.current = createBotManager({ store, engine, datasetDir: options.datasetDir, defaultTimezone: options.defaultTimezone });
  await seedSampleData(store, options.datasetDir);
  const routes: AgentsOptions = {
    database: options.database, store, engine, manager: manager.current,
    datasetDir: options.datasetDir, defaultTimezone: options.defaultTimezone,
  };
  return { store, engine, manager: manager.current, routes };
}
