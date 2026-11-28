import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../../src/server.ts';
import { hashPassword } from '../../src/users.ts';
import { createEngine } from '../../src/agents/engine.ts';
import { createAgentsStore, fixtureBot, fixtureDataset } from './helpers.ts';
import { useMemoryMongo } from '../fakes/memory-mongo.ts';

const auth = (user: string, pass: string) => ({ authorization: `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}` });
const form = (body: Record<string, string>) => ({ headers: { 'content-type': 'application/x-www-form-urlencoded' }, payload: new URLSearchParams(body).toString() });

describe('Agents console HTTP', () => {
  const database = useMemoryMongo();
  let server: FastifyInstance;
  let dir: string;
  const store = () => createAgentsStore(database().db);
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'agents-http-'));
    const engine = createEngine({ store: store(), defaultTimezone: 'UTC', llm: async () => ({ text: 'Hello from test chat', toolCalls: [] }) });
    server = buildServer({ logger: false, inventory: { items: [], apiKey: 'unused' }, agents: { database: database(), store: store(), engine, datasetDir: dir, defaultTimezone: 'UTC' } });
    await server.ready();
  });
  afterAll(async () => { await server?.close(); if (dir) await rm(dir, { recursive: true, force: true }); });
  const user = async () => (await database().users.insertOne({ username: 'alice', password: hashPassword('correct'), isAdmin: false, channelIdentities: [], createdAt: new Date() })).insertedId;
  const get = (url: string, headers?: Record<string, string>) => server.inject({ method: 'GET', url, ...(headers ? { headers } : {}) });
  const post = (url: string, body: Record<string, string>) => server.inject({ method: 'POST', url, ...form(body) });

  it('returns 503 without a User and 401 for invalid credentials', async () => {
    expect((await get('/agents')).statusCode).toBe(503);
    await user();
    expect((await get('/agents', auth('alice', 'wrong'))).statusCode).toBe(401);
    expect((await get('/agents')).statusCode).toBe(200);
  });
  it('preserves bot form input on validation errors and masks saved tokens', async () => {
    await user();
    const invalid = await post('/agents/bots', { name: 'My Test Bot', token: 'wrong', guide: 'Ask for Marina', temperature: '9', maxResults: '0' });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.body).toContain('My Test Bot');
    expect(invalid.body).toContain('Ask for Marina');
    const created = await post('/agents/bots', { name: 'Homes', token: '123456:abcdefghij', guide: '# Ask for an area', temperature: '0.4', maxResults: '2' });
    expect(created.statusCode).toBe(303);
    const bot = (await store().bots.findOne({ name: 'Homes' }))!;
    const page = await get(`/agents/bots/${bot._id}`);
    expect(page.body).toContain('# Ask for an area');
    expect(page.body).toContain('••••••••ghij');
    expect(page.body).not.toContain('123456:abcdefghij');
    const edited = await post(`/agents/bots/${bot._id}`, { name: 'Homes', token: '', guide: '# New guide' });
    expect(edited.statusCode).toBe(303);
    expect((await store().bots.findOne({ _id: bot._id }))?.guide).toBe('# New guide');
  });
  it('supports test chat reset, scoped paginated logs, and appointment filters', async () => {
    const owner = await user();
    const a = await fixtureBot(store(), null);
    const b = await fixtureBot(store(), null);
    const chat = await server.inject({ method: 'POST', url: `/agents/bots/${a._id}/test-chat`, payload: { text: 'Hi' } });
    expect(chat.statusCode).toBe(200);
    expect(chat.json().text).toBe('Hello from test chat');
    for (let i = 0; i < 23; i++) await store().messages.insertOne({ botId: a._id, channel: 'telegram', chatId: '123', role: 'customer', text: `entry ${i}`, listingIds: [], createdAt: new Date(Date.now() + i) });
    await store().messages.insertOne({ botId: b._id, channel: 'telegram', chatId: '999', role: 'customer', text: 'OTHER BOT SECRET', listingIds: [], createdAt: new Date() });
    const logs = await get(`/agents/bots/${a._id}/logs?page=2&chat=123`);
    expect(logs.statusCode).toBe(200);
    expect(logs.body).toContain('entry 0');
    expect(logs.body).not.toContain('OTHER BOT SECRET');
    await server.inject({ method: 'POST', url: `/agents/bots/${a._id}/test-chat/reset` });
    expect(await store().messages.countDocuments({ botId: a._id, channel: 'console', chatId: String(owner) })).toBe(0);
    expect(await store().messages.countDocuments({ botId: a._id, channel: 'telegram' })).toBe(23);
    await store().appointments.insertOne({ botId: a._id, listingId: b._id, listingSummary: 'Requested place', customer: { channel: 'telegram', chatId: '1', name: null }, scheduledFor: new Date(), state: 'requested', agentNotifiedAt: null, locationPromptMessageId: null, createdAt: new Date(), decidedAt: null, locationSharedAt: null });
    await store().appointments.insertOne({ botId: a._id, listingId: b._id, listingSummary: 'Declined place', customer: { channel: 'telegram', chatId: '1', name: null }, scheduledFor: new Date(), state: 'declined', agentNotifiedAt: null, locationPromptMessageId: null, createdAt: new Date(), decidedAt: null, locationSharedAt: null });
    const filtered = await get(`/agents/bots/${a._id}/appointments?state=requested`);
    expect(filtered.body).toContain('Requested place');
    expect(filtered.body).not.toContain('Declined place');
  });
  it('validates dataset upload and mapping, and blocks image path traversal', async () => {
    await user();
    const bad = await post('/agents/datasets', { filename: 'bad.csv', content: 'area,type\n"broken' });
    expect(bad.statusCode).toBe(400);
    expect(bad.body).toMatch(/unterminated/i);
    const good = await post('/agents/datasets', { filename: 'homes.csv', content: 'area,type,rent,photos,terms\nMarina,studio,4000,,monthly' });
    expect(good.statusCode).toBe(303);
    const dataset = (await store().datasets.findOne({ sourceFile: 'homes.csv' }))!;
    const invalid = await post(`/agents/datasets/${dataset._id}/mapping`, { location: 'missing', unit_type: 'type', price: 'rent', images: 'photos', payment: 'terms' });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.body).toContain('missing');
    const valid = await post(`/agents/datasets/${dataset._id}/mapping`, { location: 'area', unit_type: 'type', price: 'rent', images: 'photos', payment: 'terms' });
    expect(valid.statusCode).toBe(303);
    expect(await store().rows.countDocuments({ datasetId: dataset._id })).toBe(1);
    expect((await get('/agents/files/images/%2e%2e/%2e%2e/package.json')).statusCode).toBe(404);
  });
});
