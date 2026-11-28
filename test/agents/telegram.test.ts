import { describe, expect, it } from 'vitest';
import { Bot } from 'grammy';
import { useMemoryMongo } from '../fakes/memory-mongo.ts';
import { createAgentsStore, fixtureBot, fixtureDir } from './helpers.ts';
import { createBotManager, installHandlers, sendListingCards } from '../../src/agents/telegram.ts';
import type { AppointmentDoc, AgentsStore } from '../../src/agents/types.ts';
import { ObjectId } from 'mongodb';

const now = () => new Date('2026-11-28T10:00:00Z');
function fakeTelegram() {
  const bot = new Bot('123456:abcdefghij');
  bot.botInfo = { id: 123456, is_bot: true, first_name: 'Homes', username: 'homes_bot', can_join_groups: true, can_read_all_group_messages: false, supports_inline_queries: false } as never;
  const calls: Array<{ method: string; payload: any }> = [];
  let next = 100;
  bot.api.config.use(async (prev, method, payload) => {
    calls.push({ method, payload });
    const p = payload as Record<string, any>;
    if (method === 'sendMessage') return { ok: true, result: { message_id: next++, date: 0, chat: { id: p.chat_id, type: 'private', first_name: 'Test' }, text: p.text } } as never;
    return { ok: true, result: true } as never;
  });
  const message = async (from: number, text: string, id = 1) => bot.handleUpdate({ update_id: ++next, message: { message_id: id, date: 0, chat: { id: from, type: 'private', first_name: 'Test' }, from: { id: from, is_bot: false, first_name: 'Test' }, text } } as never);
  const location = async (from: number, replyTo?: number) => bot.handleUpdate({ update_id: ++next, message: { message_id: next + 100, date: 0, chat: { id: from, type: 'private', first_name: 'Test' }, from: { id: from, is_bot: false, first_name: 'Test' }, location: { latitude: 25.1, longitude: 55.2 }, ...(replyTo ? { reply_to_message: { message_id: replyTo, date: 0, chat: { id: from, type: 'private' } } } : {}) } } as never);
  const callback = async (from: number, id: ObjectId, answer: 'yes' | 'no') => bot.handleUpdate({ update_id: ++next, callback_query: { id: String(next), from: { id: from, is_bot: false, first_name: 'Test' }, chat_instance: 'a', data: `appt:${id}:${answer}`, message: { message_id: 5, date: 0, chat: { id: from, type: 'private', first_name: 'Test' }, text: 'Request' } } } as never);
  return { bot, calls, message, location, callback };
}
async function appointment(store: AgentsStore, botId: ObjectId, chatId: string): Promise<ObjectId> {
  const doc: AppointmentDoc = { botId, listingId: new ObjectId(), listingSummary: `Studio for ${chatId}`, customer: { channel: 'telegram', chatId, name: null }, scheduledFor: new Date('2026-12-01T12:00:00Z'), state: 'requested', agentNotifiedAt: null, locationPromptMessageId: null, createdAt: now(), decidedAt: null, locationSharedAt: null };
  return (await store.appointments.insertOne(doc)).insertedId;
}
describe('Telegram adapter', () => {
  const database = useMemoryMongo();
  it('uses single-use expiring link codes', async () => {
    const f = await fixtureDir();
    try {
      const store = createAgentsStore(database().db), doc = await fixtureBot(store, null);
      await store.bots.updateOne({ _id: doc._id }, { $set: { 'propertyAgent.linkCode': 'ABC123', 'propertyAgent.linkCodeExpiresAt': new Date('2026-11-28T10:15:00Z') } });
      const tg = fakeTelegram();
      installHandlers(tg.bot, { store, botId: doc._id, datasetDir: f.dir, timezone: 'UTC', now, engine: { handleMessage: async () => ({ text: 'hi', listings: [] }) } });
      await tg.message(77, '/link ABC123');
      expect((await store.bots.findOne({ _id: doc._id }))?.propertyAgent.telegramId).toBe(77);
      await tg.message(88, '/link ABC123');
      expect((await store.bots.findOne({ _id: doc._id }))?.propertyAgent.telegramId).toBe(77);
      await store.bots.updateOne({ _id: doc._id }, { $set: { 'propertyAgent.linkCode': 'EXPIRED', 'propertyAgent.linkCodeExpiresAt': new Date('2026-11-28T09:00:00Z') } });
      await tg.message(99, '/link EXPIRED');
      expect((await store.bots.findOne({ _id: doc._id }))?.propertyAgent.telegramId).toBe(77);
    } finally { await f.cleanup(); }
  });
  it('guards callbacks, handles double taps, and relays only the matched confirmed pin', async () => {
    const f = await fixtureDir();
    try {
      const store = createAgentsStore(database().db), doc = await fixtureBot(store, null, 77);
      const first = await appointment(store, doc._id, '101');
      const second = await appointment(store, doc._id, '202');
      const tg = fakeTelegram();
      installHandlers(tg.bot, { store, botId: doc._id, datasetDir: f.dir, timezone: 'UTC', now, engine: { handleMessage: async () => ({ text: '', listings: [] }) } });
      await tg.location(77);
      expect(tg.calls.filter((c) => c.method === 'sendLocation')).toHaveLength(0);
      await tg.callback(88, first, 'yes');
      expect((await store.appointments.findOne({ _id: first }))?.state).toBe('requested');
      await tg.callback(77, first, 'yes');
      await tg.callback(77, first, 'yes');
      expect((await store.appointments.findOne({ _id: first }))?.state).toBe('confirmed');
      const prompt1 = (await store.appointments.findOne({ _id: first }))?.locationPromptMessageId;
      expect(prompt1).toBeTypeOf('number');
      await tg.callback(77, second, 'yes');
      await tg.location(77);
      expect(tg.calls.filter((c) => c.method === 'sendLocation')).toHaveLength(0);
      await tg.location(77, prompt1!);
      expect((await store.appointments.findOne({ _id: first }))?.state).toBe('location-shared');
      expect((await store.appointments.findOne({ _id: second }))?.state).toBe('confirmed');
      expect(tg.calls.filter((c) => c.method === 'sendLocation').map((c) => c.payload.chat_id)).toEqual([101]);
      await tg.callback(77, second, 'no');
      expect((await store.appointments.findOne({ _id: second }))?.state).toBe('confirmed');
    } finally { await f.cleanup(); }
  });
  it('does not let this bot confirm another bot\'s appointment', async () => {
    const f = await fixtureDir();
    try {
      const store = createAgentsStore(database().db);
      const botA = await fixtureBot(store, null, 77);
      const botB = await fixtureBot(store, null, 77);
      const foreign = await appointment(store, botB._id, '202');
      const tg = fakeTelegram();
      installHandlers(tg.bot, { store, botId: botA._id, datasetDir: f.dir, timezone: 'UTC', now, engine: { handleMessage: async () => ({ text: '', listings: [] }) } });
      await tg.callback(77, foreign, 'yes');
      expect((await store.appointments.findOne({ _id: foreign }))?.state).toBe('requested');
      expect(tg.calls.filter((c) => c.method === 'sendMessage' && c.payload.chat_id === 202)).toHaveLength(0);
    } finally { await f.cleanup(); }
  });
  it('falls back to text when listing image is missing', async () => {
    const f = await fixtureDir();
    try {
      const tg = fakeTelegram();
      await sendListingCards(tg.bot.api, 101, [{ id: 'x', location: 'Marina', unitType: 'studio', price: 4000, priceText: 'AED 4,000', payment: 'monthly', images: ['images/gone.jpg'], data: {} }], f.dir);
      expect(tg.calls.filter((c) => c.method === 'sendPhoto')).toHaveLength(0);
      expect(tg.calls.find((c) => c.method === 'sendMessage')?.payload.text).toContain('AED 4,000');
    } finally { await f.cleanup(); }
  });
  it('reports a bad token as error without throwing', async () => {
    const f = await fixtureDir();
    try {
      const store = createAgentsStore(database().db), doc = await fixtureBot(store, null);
      const manager = createBotManager({ store, datasetDir: f.dir, defaultTimezone: 'UTC', engine: { handleMessage: async () => ({ text: '', listings: [] }) }, createBot: () => fakeTelegram().bot, launch: async () => { throw new Error('401 Unauthorized'); } });
      expect(await manager.start(doc._id)).toMatchObject({ state: 'error', error: 'Telegram rejected this token.' });
      expect((await store.bots.findOne({ _id: doc._id }))?.enabled).toBe(false);
    } finally { await f.cleanup(); }
  });
});
