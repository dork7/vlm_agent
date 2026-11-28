import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { useMemoryMongo } from '../fakes/memory-mongo.ts';
import { createAgentsStore, fixtureBot, fixtureDataset, fixtureDir } from './helpers.ts';
import { createEngine } from '../../src/agents/engine.ts';
import { transitionAppointment } from '../../src/agents/appointments.ts';
import type { AgentLlm, AgentLlmRequest } from '../../src/agents/llm.ts';

const now = () => new Date('2026-11-28T10:00:00Z');
const call = (name: string, args: object) => ({ id: 'call-1', name, arguments: JSON.stringify(args) });

describe('Agent engine', () => {
  const database = useMemoryMongo();
  it('loops through search tool; only tool rows become cards and no-results returns alternatives', async () => {
    const f = await fixtureDir();
    try {
      const store = createAgentsStore(database().db);
      const dataset = await fixtureDataset(store, f.dir);
      const bot = await fixtureBot(store, dataset._id);
      const seen: AgentLlmRequest[] = [];
      const llm: AgentLlm = async (request) => {
        seen.push(request);
        if (!request.messages.some((m) => m.role === 'tool')) return { text: null, toolCalls: [call('search_listings', { location: 'Nowhere', unit_type: '2BR' })] };
        return { text: 'No exact match; consider these alternatives.', toolCalls: [] };
      };
      const engine = createEngine({ store, llm, defaultTimezone: 'UTC', now });
      const reply = await engine.handleMessage({ botId: bot._id, channel: 'console', chatId: 'a', text: '2 bed in Nowhere' });
      expect(reply.text).toMatch(/No exact match/);
      expect(reply.listings).toHaveLength(1);
      expect(reply.listings[0]?.location).toBe('Marina');
      const tool = seen[1]?.messages.find((m) => m.role === 'tool');
      expect(tool && JSON.parse(tool.content)).toMatchObject({ count: 0, closest_alternatives: [{ price: 'AED 5,500', payment: 'monthly|yearly' }] });
      expect(reply.listings.every((l) => l.data.area !== 'Nowhere')).toBe(true);
    } finally { await f.cleanup(); }
  });
  it('isolates persistent history by bot and channel/chat and resets just one chat', async () => {
    const f = await fixtureDir();
    try {
      const store = createAgentsStore(database().db);
      const dataset = await fixtureDataset(store, f.dir);
      const a = await fixtureBot(store, dataset._id);
      const b = await fixtureBot(store, dataset._id);
      const seen: AgentLlmRequest[] = [];
      const engine = createEngine({ store, defaultTimezone: 'UTC', now, llm: async (r) => { seen.push(r); return { text: 'ok', toolCalls: [] }; } });
      const send = (botId: typeof a._id, chatId: string) => engine.handleMessage({ botId, channel: 'console', chatId, text: 'hello' });
      await send(a._id, 'one'); await send(a._id, 'one'); await send(a._id, 'two'); await send(b._id, 'one');
      expect(seen.map((r) => r.messages.length)).toEqual([2, 4, 2, 2]);
      await engine.resetChat(a._id, 'console', 'one');
      await send(a._id, 'one');
      expect(seen.at(-1)?.messages).toHaveLength(2);
      expect(await store.messages.countDocuments({ botId: a._id, chatId: 'two' })).toBe(2);
    } finally { await f.cleanup(); }
  });
  it('rejects bad and past bookings, blocks bookings without an agent, and cannot confirm via LLM', async () => {
    const f = await fixtureDir();
    try {
      const store = createAgentsStore(database().db);
      const dataset = await fixtureDataset(store, f.dir);
      const listing = (await store.rows.findOne({ datasetId: dataset._id }))!;
      const bot = await fixtureBot(store, dataset._id, 77);
      const results: any[] = [];
      const attempted = [
        { date: '2026-02-30', time: '12:00' },
        { date: '2026-11-27', time: '12:00' },
        { date: '2026-12-01', time: '12:00' },
      ];
      let index = 0;
      const engine = createEngine({ store, defaultTimezone: 'UTC', now, llm: async (r) => {
        const tool = r.messages.findLast((m) => m.role === 'tool');
        if (tool) { results.push(JSON.parse(tool.content)); return { text: 'Please wait', toolCalls: [] }; }
        return { text: null, toolCalls: [call('book_appointment', { listing_id: String(listing._id), ...attempted[index++] })] };
      } });
      for (let i = 0; i < 3; i++) await engine.handleMessage({ botId: bot._id, channel: 'telegram', chatId: '123', text: 'book' });
      expect(results[0]).toMatchObject({ ok: false });
      expect(results[1]).toMatchObject({ ok: false });
      expect(results[2]).toMatchObject({ ok: true, status: 'requested' });
      const appointment = (await store.appointments.findOne({ botId: bot._id }))!;
      expect(appointment.state).toBe('requested');
      expect(await store.appointments.countDocuments({ botId: bot._id })).toBe(1);
      const noAgent = await fixtureBot(store, dataset._id);
      const other = createEngine({ store, defaultTimezone: 'UTC', now, llm: async (r) => r.messages.some((m) => m.role === 'tool') ? { text: 'unavailable', toolCalls: [] } : { text: null, toolCalls: [call('book_appointment', { listing_id: String(listing._id), date: '2026-12-01', time: '12:00' })] } });
      await other.handleMessage({ botId: noAgent._id, channel: 'telegram', chatId: '9', text: 'book' });
      expect(await store.appointments.countDocuments({ botId: noAgent._id })).toBe(0);
      expect((await transitionAppointment(store, appointment._id, 'location-shared')).ok).toBe(false);
      expect((await transitionAppointment(store, appointment._id, 'confirmed')).ok).toBe(true);
      expect((await transitionAppointment(store, appointment._id, 'confirmed')).ok).toBe(false);
      expect((await transitionAppointment(store, appointment._id, 'declined')).ok).toBe(false);
      expect((await transitionAppointment(store, appointment._id, 'location-shared')).ok).toBe(true);
    } finally { await f.cleanup(); }
  });
  it('does not pass through invented listing prices from an LLM reply', async () => {
    const f = await fixtureDir();
    try {
      const store = createAgentsStore(database().db);
      const dataset = await fixtureDataset(store, f.dir);
      const bot = await fixtureBot(store, dataset._id);
      const engine = createEngine({ store, defaultTimezone: 'UTC', now, llm: async () => ({ text: 'Marina studio is AED 999 per month.', toolCalls: [] }) });
      const reply = await engine.handleMessage({ botId: bot._id, channel: 'console', chatId: 'x', text: 'Find a studio' });
      expect(reply.text).not.toContain('AED 999');
      expect(reply.listings).toEqual([]);
    } finally { await f.cleanup(); }
  });
  it('keeps grammY out of the engine source', async () => {
    expect(await readFile(new URL('../../src/agents/engine.ts', import.meta.url), 'utf8')).not.toMatch(/\b(?:from|import)\s*\(?["']grammy/);
  });
});
