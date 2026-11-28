import { access } from "node:fs/promises";
import { Bot, InlineKeyboard, InputFile, type Context } from "grammy";
import type { Api } from "grammy";
import { ObjectId } from "mongodb";
import { formatInstant } from "../time.ts";
import { transitionAppointment } from "./appointments.ts";
import { insideFolder } from "./dataset.ts";
import type { Engine } from "./engine.ts";
import type { AgentBotDoc, AgentsStore, AppointmentDoc, Listing } from "./types.ts";

const FAILURE = "Sorry, I couldn't process that. Please try again.";
const APPOINTMENT_BUTTON = /^appt:([0-9a-f]{24}):(yes|no)$/;
const LINK_COMMAND = /^\/link(?:@\w+)?\s+(\S+)/i;
export const TELEGRAM_CHANNEL = "telegram";
type Appt = AppointmentDoc & { _id: ObjectId };

export type HandlerContext = {
  store: AgentsStore;
  engine: Pick<Engine, "handleMessage">;
  botId: ObjectId;
  datasetDir: string;
  timezone: string;
  now?: () => Date;
  /** Whether the bot is meant to be answering; a stopped bot ignores any update still in flight. */
  isActive?: () => boolean;
};

/** The caption of a Listing's card, straight from its Dataset row. */
export function cardCaption(listing: Listing): string {
  const lines = [`📍 ${listing.location}`, `🏠 ${listing.unitType}`, `💰 ${listing.priceText}`];
  if (listing.payment) lines.push(`💳 ${listing.payment}`);
  return lines.join("\n").slice(0, 1024);
}

/** Sends each Listing as a photo (album when it has several) with its caption; a Listing without a readable image is text only. */
export async function sendListingCards(api: Pick<Api, "sendMessage" | "sendPhoto" | "sendMediaGroup">, chatId: number, listings: Listing[], datasetDir: string): Promise<void> {
  for (const listing of listings) {
    const caption = cardCaption(listing);
    const files: string[] = [];
    for (const image of listing.images.slice(0, 10)) {
      const path = insideFolder(datasetDir, image);
      if (path && (await access(path).then(() => true, () => false))) files.push(path);
    }
    try {
      if (files.length === 0) await api.sendMessage(chatId, caption);
      else if (files.length === 1) await api.sendPhoto(chatId, new InputFile(files[0]!), { caption });
      else await api.sendMediaGroup(chatId, files.map((f, i) => ({ type: "photo" as const, media: new InputFile(f), ...(i === 0 ? { caption } : {}) })));
    } catch {
      await api.sendMessage(chatId, caption);
    }
  }
}

/** Tells the Customer something on their channel; console test chats have no one to tell. */
async function tellCustomer(api: Pick<Api, "sendMessage">, appointment: AppointmentDoc, text: string): Promise<void> {
  if (appointment.customer.channel !== TELEGRAM_CHANNEL) return;
  await api.sendMessage(Number(appointment.customer.chatId), text).catch(() => undefined);
}

const when = (a: AppointmentDoc, tz: string) => `${a.listingSummary} on ${formatInstant(a.scheduledFor, tz)}`;

/** Messages the Property Agent about a new request, with Confirm and Decline buttons; marks it notified. False when there is no one to tell. */
export async function notifyPropertyAgent(store: AgentsStore, api: Pick<Api, "sendMessage">, bot: AgentBotDoc, appointment: AppointmentDoc & { _id: ObjectId }, timezone: string, now = () => new Date()): Promise<boolean> {
  const agentId = bot.propertyAgent.telegramId;
  if (agentId === null) return false;
  const who = appointment.customer.name ?? `customer ${appointment.customer.chatId}`;
  await api.sendMessage(agentId, `New viewing request\nCustomer: ${who}\nListing: ${appointment.listingSummary}\nTime: ${formatInstant(appointment.scheduledFor, timezone)}`, {
    reply_markup: new InlineKeyboard().text("Confirm", `appt:${appointment._id}:yes`).text("Decline", `appt:${appointment._id}:no`),
  });
  await store.appointments.updateOne({ _id: appointment._id }, { $set: { agentNotifiedAt: now() } });
  return true;
}

/** Wires one grammY bot to the engine, the linking code and the Property Agent's buttons and location pins. */
export function installHandlers(bot: Bot, ctx: HandlerContext): void {
  const { store, engine, botId, datasetDir, timezone, now = () => new Date() } = ctx;
  const chains = new Map<string, Promise<unknown>>();
  const serial = <T>(key: string, job: () => Promise<T>): Promise<T> => {
    const run = (chains.get(key) ?? Promise.resolve()).then(job, job);
    chains.set(key, run.catch(() => undefined));
    return run;
  };
  const freshBot = () => store.bots.findOne({ _id: botId });
  const active = () => ctx.isActive?.() ?? true;

  bot.on("message:text", async (c) => {
    if (!active()) return;
    const text = c.message.text.trim();
    const from = c.from;
    const link = LINK_COMMAND.exec(text);
    const current = await freshBot();
    if (!current) return;
    const code = (link?.[1] ?? text).toUpperCase();
    if (from && current.propertyAgent.linkCode && (link || code === current.propertyAgent.linkCode)) {
      const linked = await store.bots.findOneAndUpdate(
        { _id: botId, "propertyAgent.linkCode": code, "propertyAgent.linkCodeExpiresAt": { $gt: now() } },
        { $set: { "propertyAgent.telegramId": from.id, "propertyAgent.name": [from.first_name, from.last_name].filter(Boolean).join(" ") || null, "propertyAgent.linkCode": null, "propertyAgent.linkCodeExpiresAt": null } },
      );
      await c.reply(linked ? "You are now the Property Agent for this bot. I will send you viewing requests here." : "That code is invalid or has expired. Ask the operator for a new one.");
      return;
    }
    if (link) { await c.reply("That code is invalid or has expired. Ask the operator for a new one."); return; }

    const chatId = String(c.chat.id);
    await serial(chatId, async () => {
      try {
        await c.replyWithChatAction("typing").catch(() => undefined);
        const reply = await engine.handleMessage({
          botId, channel: TELEGRAM_CHANNEL, chatId, text: text === "/start" ? "Hi" : text,
          customerName: [from?.first_name, from?.last_name].filter(Boolean).join(" ") || null,
        });
        if (reply.text) await c.reply(reply.text);
        await sendListingCards(c.api, c.chat.id, reply.listings, datasetDir);
      } catch {
        await c.reply(FAILURE).catch(() => undefined);
      }
    });
  });

  bot.on("callback_query:data", async (c) => {
    const match = APPOINTMENT_BUTTON.exec(c.callbackQuery.data);
    if (!match || !active()) { await c.answerCallbackQuery().catch(() => undefined); return; }
    const current = await freshBot();
    if (!current || current.propertyAgent.telegramId === null || current.propertyAgent.telegramId !== c.from.id) {
      await c.answerCallbackQuery({ text: "Only the Property Agent can answer this request." }).catch(() => undefined);
      return;
    }
    const id = new ObjectId(match[1]!);
    const confirm = match[2] === "yes";
    if (!(await store.appointments.findOne({ _id: id, botId }))) {
      await c.answerCallbackQuery({ text: "That request no longer exists." }).catch(() => undefined);
      return;
    }
    const moved = await transitionAppointment(store, id, confirm ? "confirmed" : "declined", {}, now);
    if (!moved.ok) {
      await c.answerCallbackQuery({ text: moved.reason === "not-found" ? "That request no longer exists." : `Already ${moved.current}. Nothing changed.` }).catch(() => undefined);
      return;
    }
    const a = moved.appointment;
    await c.answerCallbackQuery({ text: confirm ? "Confirmed" : "Declined" }).catch(() => undefined);
    await c.editMessageText(`${confirm ? "✅ Confirmed" : "❌ Declined"}: ${when(a, timezone)}`).catch(() => undefined);
    if (!confirm) {
      await tellCustomer(c.api, a, `Sorry, the Property Agent can't do ${when(a, timezone)}. Would another time work?`);
      return;
    }
    await tellCustomer(c.api, a, `Good news: your viewing of ${when(a, timezone)} is confirmed. The Property Agent will share the location shortly.`);
    const prompt = await c.api.sendMessage(current.propertyAgent.telegramId, `Please share the apartment's location for ${when(a, timezone)}: reply to this message with a Telegram location pin.`, { reply_markup: { force_reply: true } });
    await store.appointments.updateOne({ _id: a._id }, { $set: { locationPromptMessageId: prompt.message_id } });
  });

  bot.on("message:location", async (c) => {
    if (!active()) return;
    const current = await freshBot();
    if (!current || current.propertyAgent.telegramId === null || current.propertyAgent.telegramId !== c.from.id) {
      await c.reply("Thanks, but I can only use locations from the Property Agent.");
      return;
    }
    const repliedTo = c.message.reply_to_message?.message_id;
    let target: Appt | null = null;
    if (repliedTo !== undefined) target = (await store.appointments.findOne({ botId, locationPromptMessageId: repliedTo, state: "confirmed" })) ?? null;
    if (!target) {
      const open = await store.appointments.find({ botId, state: "confirmed" }).sort({ createdAt: 1 }).toArray();
      if (open.length === 0) { await c.reply("No confirmed viewing is waiting for a location."); return; }
      if (open.length > 1) {
        await c.reply(`Several viewings are waiting for a location:\n${open.map((a) => `• ${when(a, timezone)}`).join("\n")}\nReply to the prompt of the one you mean with the pin.`);
        return;
      }
      target = open[0]!;
    }
    const moved = await transitionAppointment(store, target!._id, "location-shared", {}, now);
    if (!moved.ok) { await c.reply("That viewing's location was already shared."); return; }
    const a = moved.appointment;
    await tellCustomer(c.api, a, `Here is the location for your viewing of ${when(a, timezone)}:`);
    if (a.customer.channel === TELEGRAM_CHANNEL) await c.api.sendLocation(Number(a.customer.chatId), c.message.location.latitude, c.message.location.longitude).catch(() => undefined);
    await c.reply(`Location sent to the customer for ${when(a, timezone)}.`);
  });

  bot.catch(() => undefined);
}

export type BotStatus = { state: "stopped" | "running" | "error"; error?: string };

export type ManagerOptions = {
  store: AgentsStore;
  engine: Pick<Engine, "handleMessage">;
  datasetDir: string;
  defaultTimezone: string;
  now?: () => Date;
  createBot?: (token: string) => Bot;
  /** Checks the token and begins receiving updates; resolves once running, rejects on a bad token. */
  launch?: (bot: Bot) => Promise<void>;
  shutdown?: (bot: Bot) => Promise<void>;
};

export type BotManager = ReturnType<typeof createBotManager>;

/** Runs one grammY bot per enabled Agent Bot, started and stopped from the console. */
export function createBotManager(options: ManagerOptions) {
  const { store, defaultTimezone, now = () => new Date() } = options;
  const createBot = options.createBot ?? ((token: string) => new Bot(token));
  const launch = options.launch ?? (async (bot: Bot) => {
    await bot.init();
    void bot.start({ drop_pending_updates: false }).catch(() => undefined);
  });
  const shutdown = options.shutdown ?? (async (bot: Bot) => { if (bot.isRunning()) await bot.stop(); });
  const running = new Map<string, Bot>();
  const status = new Map<string, BotStatus>();

  async function stopBot(key: string) {
    const bot = running.get(key);
    running.delete(key);
    if (bot) await shutdown(bot).catch(() => undefined);
  }

  const manager = {
    status(id: ObjectId | string): BotStatus { return status.get(String(id)) ?? { state: "stopped" }; },
    isRunning(id: ObjectId | string) { return running.has(String(id)); },

    /** Starts the bot; a bad token is recorded as its error and never thrown. */
    async start(id: ObjectId): Promise<BotStatus> {
      const key = String(id);
      await stopBot(key);
      const doc = await store.bots.findOne({ _id: id });
      if (!doc) { status.set(key, { state: "error", error: "That Agent Bot does not exist." }); return status.get(key)!; }
      const bot = createBot(doc.token);
      installHandlers(bot, { store, engine: options.engine, botId: id, datasetDir: options.datasetDir, timezone: defaultTimezone, now, isActive: () => running.get(key) === bot });
      try {
        running.set(key, bot);
        await launch(bot);
      } catch (error) {
        running.delete(key);
        const reason = error instanceof Error ? error.message : String(error);
        status.set(key, { state: "error", error: /401|unauthori[sz]ed|not found/i.test(reason) ? "Telegram rejected this token." : `Could not start: ${reason}` });
        await store.bots.updateOne({ _id: id }, { $set: { enabled: false } });
        return status.get(key)!;
      }
      status.set(key, { state: "running" });
      await store.bots.updateOne({ _id: id }, { $set: { enabled: true } });
      await manager.deliverPending(id);
      return status.get(key)!;
    },

    async stop(id: ObjectId): Promise<BotStatus> {
      await stopBot(String(id));
      status.set(String(id), { state: "stopped" });
      await store.bots.updateOne({ _id: id }, { $set: { enabled: false } });
      return status.get(String(id))!;
    },

    /** Applies an edited token to a running bot; other edits apply on the next message without a restart. */
    async reload(id: ObjectId): Promise<void> {
      if (running.has(String(id))) await manager.start(id);
    },

    async startAll(): Promise<void> {
      for (const doc of await store.bots.find({ enabled: true }).toArray()) await manager.start(doc._id);
    },

    async stopAll(): Promise<void> {
      for (const key of [...running.keys()]) await stopBot(key);
    },

    /** Tells the Property Agent of a request through the running bot; when the bot is stopped it is sent when it starts. */
    async notifyAppointment(appointment: AppointmentDoc & { _id: ObjectId }, doc: AgentBotDoc & { _id: ObjectId }): Promise<void> {
      const bot = running.get(String(doc._id));
      if (!bot) return;
      await notifyPropertyAgent(store, bot.api, doc, appointment, defaultTimezone, now);
    },

    /** Sends the Property Agent every request made while the bot was stopped. */
    async deliverPending(id: ObjectId): Promise<void> {
      const bot = running.get(String(id));
      const doc = await store.bots.findOne({ _id: id });
      if (!bot || !doc) return;
      for (const a of await store.appointments.find({ botId: id, state: "requested", agentNotifiedAt: null }).toArray()) {
        await notifyPropertyAgent(store, bot.api, doc, a as AppointmentDoc & { _id: ObjectId }, defaultTimezone, now).catch(() => undefined);
      }
    },
  };
  return manager;
}
