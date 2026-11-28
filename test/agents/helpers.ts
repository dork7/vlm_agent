import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ObjectId } from 'mongodb';
import { DEFAULT_PERSONA, createAgentsStore, type AgentsStore, type AgentBotDoc } from '../../src/agents/types.ts';
import { importDataset } from '../../src/agents/dataset.ts';

export async function fixtureDir() {
  const dir = await mkdtemp(join(tmpdir(), 'agents-test-'));
  await mkdir(join(dir, 'images'));
  return { dir, write: (name: string, content: string) => writeFile(join(dir, name), content), cleanup: () => rm(dir, { recursive: true, force: true }) };
}
export const mapping = { location: 'area', unit_type: 'type', price: 'rent', images: 'photos', payment: 'terms' };
export const csv = 'area,type,rent,photos,terms\nMarina,2 bed,"AED 5,500",missing.jpg,monthly|yearly\nDowntown,studio,"AED 4,000",,monthly';
export async function fixtureDataset(store: AgentsStore, dir: string, filename = 'homes.csv') {
  await writeFile(join(dir, filename), csv);
  return importDataset({ store, datasetDir: dir, sourceFile: filename, mapping });
}
export async function fixtureBot(store: AgentsStore, datasetId: ObjectId | null, agentId: number | null = null) {
  const at = new Date('2026-11-28T00:00:00Z');
  const doc: AgentBotDoc = { name: 'Homes', token: '123456:abcdefghij', datasetId, persona: DEFAULT_PERSONA, guide: 'Ask for area and type.', enabled: false, propertyAgent: { telegramId: agentId, name: agentId ? 'Agent' : null, linkCode: null, linkCodeExpiresAt: null }, createdAt: at, updatedAt: at };
  const { insertedId } = await store.bots.insertOne(doc);
  return { ...doc, _id: insertedId };
}
export { createAgentsStore };
