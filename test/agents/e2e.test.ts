import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Bot } from 'grammy';
import { ObjectId } from 'mongodb';
import { buildServer } from '../../src/server.ts';
import { hashPassword } from '../../src/users.ts';
import { createEngine } from '../../src/agents/engine.ts';
import { createBotManager } from '../../src/agents/telegram.ts';
import { seedSampleData } from '../../src/agents/sample.ts';
import { createAgentsStore } from '../../src/agents/types.ts';
import type { AgentLlm } from '../../src/agents/llm.ts';
import { useMemoryMongo } from '../fakes/memory-mongo.ts';

// End-to-end pass over the shipped sample Dataset, following the README steps, with a scripted LLM and a recording Telegram transport.
const datasetDir = resolve('dataset');

function transport() {
  const bot = new Bot('123456:abcdefghij');
  bot.botInfo = { id: 123456, is_bot: true, first_name: 'Homes', username: 'homes_bot', can_join_groups: true, can_read_all_group_messages: false, supports_inline_queries: false } as never;
  const calls: Array<{ method: string; payload: any }> = [];
  let next = 100;
  bot.api.config.use(async (_prev, method, payload) => {
    calls.push({ method, payload });
    const p = payload as Record<string, any>;
    if (method === 'sendMessage') return { ok: true, result: { message_id: next++, date: 0, chat: { id: p.chat_id, type: 'private' }, text: p.text } } as never;
    return { ok: true, result: true } as never;
  });
  const chat = (from: number) => ({ chat: { id: from, type: 'private', first_name: 'T' }, from: { id: from, is_bot: false, first_name: 'T' } });
  return {
    bot, calls,
    text: (from: number, text: string) => bot.handleUpdate({ update_id: ++next, message: { message_id: ++next, date: 0, ...chat(from), text } } as never),
    callback: (from: number, data: string) => bot.handleUpdate({ update_id: ++next, callback_query: { id: String(next), from: chat(from).from, chat_instance: 'a', data, message: { message_id: 5, date: 0, ...chat(from), text: 'Request' } } } as never),
    location: (from: number, replyTo: number) => bot.handleUpdate({ update_id: ++next, message: { message_id: ++next, date: 0, ...chat(from), location: { latitude: 25.08, longitude: 55.14 }, reply_to_message: { message_id: replyTo, date: 0, chat: { id: from, type: 'private' } } } } as never),
  };
}

describe('end to end with the sample bot', () => {
  const database = useMemoryMongo();
  it('search, booking, Property Agent link and confirm, location relay, console views', async () => {
    const store = createAgentsStore(database().db);
    await seedSampleData(store, datasetDir, {});
    const bot = (await store.bots.findOne({}))!;
    const dataset = (await store.datasets.findOne({}))!;
    expect(bot.name).toBe('Sample Real Estate Bot');
    expect(bot.guide).toContain('Viewings');
    expect(dataset.mapping).not.toBeNull();
    expect(dataset.rowCount).toBeGreaterThanOrEqual(12);
    expect(dataset.missingImages).toEqual([]);
    await seedSampleData(store, datasetDir, {}); // idempotent
    expect(await store.bots.countDocuments()).toBe(1);

    const tg = transport();
    const sent = (method: string) => tg.calls.filter((c) => c.method === method);
    const llm: AgentLlm = async ({ messages }) => {
      const last = messages[messages.length - 1]!;
      const user = [...messages].reverse().find((m) => m.role === 'user')!.content as string;
      if (last.role === 'tool') {
        const result = JSON.parse(last.content);
        if (result.listings) return { text: `Found ${result.listings[0].unit_type} in ${result.listings[0].location}: ${result.listings[0].price}`, toolCalls: [] };
        return { text: `Request sent: ${result.note}`, toolCalls: [] };
      }
      if (/marina/i.test(user)) return { text: null, toolCalls: [{ id: 's1', name: 'search_listings', arguments: JSON.stringify({ location: 'marina', unit_type: '2 bed' }) }] };
      if (/book/i.test(user)) {
        const history = messages.map((m) => (typeof m.content === 'string' ? m.content : '')).join('\n');
        const id = /id ([0-9a-f]{24})/.exec(history)![1]!;
        const date = new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10);
        return { text: null, toolCalls: [{ id: 'b1', name: 'book_appointment', arguments: JSON.stringify({ listing_id: id, date, time: '17:00' }) }] };
      }
      return { text: 'Hello! Which area and unit type?', toolCalls: [] };
    };
    const manager: { current?: ReturnType<typeof createBotManager> } = {};
    const engine = createEngine({ store, llm, defaultTimezone: 'Asia/Dubai', hooks: { appointmentRequested: (a, b) => manager.current!.notifyAppointment(a, b) } });
    manager.current = createBotManager({ store, engine, datasetDir, defaultTimezone: 'Asia/Dubai', createBot: () => tg.bot, launch: async () => undefined });
    await database().users.insertOne({ username: 'admin', password: hashPassword('pw'), isAdmin: true, channelIdentities: [], createdAt: new Date() });
    const server = buildServer({ logger: false, inventory: { items: [], apiKey: 'x' }, agents: { database: database(), store, engine, manager: manager.current, datasetDir, defaultTimezone: 'Asia/Dubai' } });
    await server.ready();
    try {
      const page = await server.inject({ method: 'GET', url: '/agents' });
      expect(page.statusCode).toBe(200);
      expect(page.body).toContain('Sample Real Estate Bot');
      expect((await server.inject({ method: 'POST', url: `/agents/bots/${bot._id}/start` })).statusCode).toBe(303);
      expect(manager.current.status(bot._id).state).toBe('running');

      // Booking before a Property Agent is linked is refused by the tool.
      const early = await server.inject({ method: 'POST', url: `/agents/bots/${bot._id}/test-chat`, payload: { text: 'marina 2 bed' } });
      expect(early.json().listings.length).toBeGreaterThan(0);

      // Link the Property Agent with a console code.
      await server.inject({ method: 'POST', url: `/agents/bots/${bot._id}/link-code` });
      const code = (await store.bots.findOne({ _id: bot._id }))!.propertyAgent.linkCode!;
      expect((await server.inject({ method: 'GET', url: `/agents/bots/${bot._id}` })).body).toContain(code);
      await tg.text(77, `/link ${code}`);
      expect((await store.bots.findOne({ _id: bot._id }))!.propertyAgent.telegramId).toBe(77);

      // Customer searches on Telegram: reply text plus a card with the Dataset price.
      await tg.text(5001, '2 bed near marina');
      const reply = sent('sendMessage').filter((c) => c.payload.chat_id === 5001).at(-1)!;
      expect(reply.payload.text).toContain('AED 9,800 / month');
      const cards = [...sent('sendMediaGroup'), ...sent('sendPhoto')];
      expect(cards.length).toBeGreaterThan(0);
      const caption = cards[0]!.method === 'sendMediaGroup' ? cards[0]!.payload.media[0].caption : cards[0]!.payload.caption;
      expect(caption).toContain('AED 9,800 / month');
      expect(caption).toContain('Yearly: AED 111,720');

      // Booking notifies the Property Agent with Confirm / Decline.
      await tg.text(5001, 'please book it');
      const request = sent('sendMessage').find((c) => c.payload.chat_id === 77 && c.payload.reply_markup)!;
      expect(request).toBeDefined();
      const appt = (await store.appointments.findOne({}))!;
      expect(appt.state).toBe('requested');
      expect(appt.agentNotifiedAt).not.toBeNull();
      const requestedView = await server.inject({ method: 'GET', url: `/agents/bots/${bot._id}/appointments?state=requested` });
      expect(requestedView.body).toContain(appt.listingSummary);

      // A stranger cannot confirm; the Property Agent can.
      await tg.callback(999, `appt:${appt._id}:yes`);
      expect((await store.appointments.findOne({}))!.state).toBe('requested');
      await tg.callback(77, `appt:${appt._id}:yes`);
      const confirmed = (await store.appointments.findOne({}))!;
      expect(confirmed.state).toBe('confirmed');
      expect(sent('sendMessage').some((c) => c.payload.chat_id === 5001 && /confirmed/i.test(c.payload.text))).toBe(true);

      // Location pin relay.
      await tg.location(77, confirmed.locationPromptMessageId!);
      expect((await store.appointments.findOne({}))!.state).toBe('location-shared');
      const pin = sent('sendLocation').filter((c) => c.payload.chat_id === 5001);
      expect(pin).toHaveLength(1);
      expect(pin[0]!.payload.latitude).toBe(25.08);

      // Console filters and logs.
      const shared = await server.inject({ method: 'GET', url: `/agents/bots/${bot._id}/appointments?state=location-shared` });
      expect(shared.body).toContain(appt.listingSummary);
      const none = await server.inject({ method: 'GET', url: `/agents/bots/${bot._id}/appointments?state=requested` });
      expect(none.body).not.toContain(appt.listingSummary);
      const logs = await server.inject({ method: 'GET', url: `/agents/bots/${bot._id}/logs?chat=5001` });
      expect(logs.body).toContain('2 bed near marina');
      expect(logs.body).toContain('AED 9,800');
      expect(new ObjectId(String(appt.botId)).equals(bot._id)).toBe(true);
    } finally { await server.close(); await manager.current.stopAll(); }
  }, 60_000);
});
