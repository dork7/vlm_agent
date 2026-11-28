import { ObjectId } from "mongodb";
import type { Tool } from "../llm/openrouter.ts";
import { instantToWallClock, todayIn, formatInstant } from "../time.ts";
import { parseViewingTime } from "./appointments.ts";
import { getListing, searchListings, toListing } from "./dataset.ts";
import type { AgentChatMessage, AgentLlm } from "./llm.ts";
import type { AgentBotDoc, AgentsStore, AppointmentDoc, DatasetDoc, Listing } from "./types.ts";

export type EngineOptions = {
  store: AgentsStore;
  llm: AgentLlm;
  defaultTimezone: string;
  now?: () => Date;
  hooks?: {
    /** Called once a viewing request is saved, so the channel can tell the Property Agent. Failures are the hook's to handle. */
    appointmentRequested?: (appointment: AppointmentDoc & { _id: ObjectId }, bot: AgentBotDoc & { _id: ObjectId }) => Promise<void>;
  };
};

export type ChatInput = { botId: ObjectId; channel: string; chatId: string; text: string; customerName?: string | null };
export type ChatReply = { text: string; listings: Listing[] };

const MAX_HISTORY = 20;
const MAX_ROUNDS = 6;

export class EngineError extends Error {}

export type Engine = ReturnType<typeof createEngine>;

/** The channel-neutral conversation engine: (bot, chat, text) in, reply text plus Listings out. It knows nothing of Telegram. */
export function createEngine(options: EngineOptions) {
  const { store, llm, defaultTimezone, now = () => new Date(), hooks } = options;

  const searchTool: Tool = {
    type: "function",
    function: {
      name: "search_listings",
      description: "Search the Dataset of Listings. Only filter on what the customer said. Prices and payment options you tell the customer must come from these results.",
      parameters: {
        type: "object",
        properties: {
          location: { type: "string", description: "Area or neighbourhood the customer wants, e.g. 'marina'" },
          unit_type: { type: "string", description: "studio, 1BHK, 2BHK, ... (any spelling)" },
          min_price: { type: "number" },
          max_price: { type: "number" },
          sort: { type: "string", enum: ["price_asc", "price_desc"], description: "price_asc for 'cheaper', price_desc for 'more expensive'" },
          limit: { type: "number", description: "How many to return" },
          skip_ids: { type: "array", items: { type: "string" }, description: "Listing ids already shown, to give different ones for 'show more'" },
        },
      },
    },
  };
  const bookTool: Tool = {
    type: "function",
    function: {
      name: "book_appointment",
      description: "Request a viewing of one Listing once the customer is interested and has given a date and time. This only sends a request to the Property Agent; it is not confirmed until they accept.",
      parameters: {
        type: "object",
        properties: {
          listing_id: { type: "string" },
          date: { type: "string", description: "YYYY-MM-DD in the bot's timezone" },
          time: { type: "string", description: "HH:MM, 24-hour, in the bot's timezone" },
        },
        required: ["listing_id", "date", "time"],
      },
    },
  };

  const systemPrompt = (bot: AgentBotDoc, dataset: DatasetDoc | null, locations: string[], unitTypes: string[]) => {
    const today = todayIn(now(), defaultTimezone);
    const clock = instantToWallClock(now(), defaultTimezone);
    return [
      `You are "${bot.name}", a chat assistant that helps customers find homes. Tone: ${bot.persona.tone}. Reply in ${bot.persona.language}.`,
      "## Conversation Guide\n" + (bot.guide.trim() || "Ask where the customer wants a home and whether they want a studio, 1BHK or 2BHK, then show matching listings."),
      dataset?.mapping
        ? `## Dataset\nDataset "${dataset.name}" has ${dataset.rowCount} listings. Fields: ${dataset.fields.join(", ")}. Locations available: ${locations.join(", ") || "none"}. Unit types available: ${unitTypes.join(", ") || "none"}.`
        : "## Dataset\nNo Dataset is connected, so you cannot show listings.",
      [
        "## Rules",
        "- Never invent listings, prices, payment options or photos. Use search_listings and quote prices and payment options exactly as the tool returns them.",
        "- Listing photos and a price card are attached automatically for the listings your search returns, so do not paste image links; you may refer to them briefly.",
        "- If the location or unit type is missing, ask for it before searching.",
        "- If nothing matches, say so and suggest the alternatives the tool returns or the available locations and unit types. Do not make a listing up.",
        "- When the customer likes a listing, offer to schedule a viewing. Collect a date and time, then call book_appointment. If it fails, tell the customer why and ask again.",
        "- You cannot confirm, decline or share the exact location of a viewing; only the Property Agent can. After booking say the request is waiting for the Property Agent.",
        `- Today is ${today.weekday} ${today.date}, now ${clock.time}, timezone ${defaultTimezone}. Resolve words like "tomorrow" to a real date.`,
      ].join("\n"),
    ].join("\n\n");
  };

  async function history(bot: AgentBotDoc & { _id: ObjectId }, channel: string, chatId: string, dataset: DatasetDoc | null): Promise<AgentChatMessage[]> {
    const recent = (await store.messages.find({ botId: bot._id, channel, chatId }).sort({ createdAt: -1, _id: -1 }).limit(MAX_HISTORY).toArray()).reverse();
    const ids = recent.flatMap((m) => m.listingIds);
    const rows = ids.length ? await store.rows.find({ _id: { $in: ids } }).toArray() : [];
    return recent.map((m): AgentChatMessage => {
      if (m.role === "customer") return { role: "user", content: m.text };
      const shown = m.listingIds.flatMap((id) => {
        const row = rows.find((r) => r._id.equals(id));
        if (!row) return [];
        const l = toListing(row as never, dataset?.mapping ?? null);
        return [`id ${l.id}: ${l.location}, ${l.unitType}, ${l.priceText}, ${l.payment}`];
      });
      return { role: "assistant", content: shown.length ? `${m.text}\n[Listings shown with this reply: ${shown.join(" | ")}]` : m.text };
    });
  }

  const forLlm = (l: Listing) => ({ id: l.id, location: l.location, unit_type: l.unitType, price: l.priceText, payment: l.payment, details: Object.fromEntries(Object.entries(l.data).filter(([k]) => !/image|photo|picture/i.test(k))) });

  async function runSearch(bot: AgentBotDoc & { _id: ObjectId }, args: Record<string, unknown>) {
    if (!bot.datasetId) return { listings: [] as Listing[], result: { error: "No Dataset is connected." } };
    const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
    const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
    const skip = new Set(Array.isArray(args.skip_ids) ? args.skip_ids.map(String) : []);
    const limit = Math.min(num(args.limit) ?? bot.persona.maxResults, bot.persona.maxResults);
    const filters = {
      location: str(args.location), unitType: str(args.unit_type), minPrice: num(args.min_price), maxPrice: num(args.max_price),
      sort: args.sort === "price_desc" ? ("price_desc" as const) : ("price_asc" as const),
    };
    const find = async (f: typeof filters) => (await searchListings(store, bot.datasetId!, { ...f, limit: limit + skip.size })).filter((l) => !skip.has(l.id)).slice(0, limit);
    const exact = await find(filters);
    if (exact.length) return { listings: exact, result: { count: exact.length, listings: exact.map(forLlm) } };
    const alternatives: Listing[] = [];
    const relaxations = [{ ...filters, maxPrice: undefined, minPrice: undefined }, { ...filters, unitType: undefined }, { ...filters, location: undefined }];
    for (const relaxed of relaxations) {
      if (JSON.stringify(relaxed) === JSON.stringify(filters)) continue;
      for (const l of await find(relaxed)) if (!alternatives.some((a) => a.id === l.id)) alternatives.push(l);
      if (alternatives.length >= limit) break;
    }
    const closest = alternatives.slice(0, limit);
    return {
      listings: closest,
      result: { count: 0, note: "Nothing matches exactly. Do not claim these match; offer them as the closest alternatives.", closest_alternatives: closest.map(forLlm) },
    };
  }

  async function book(bot: AgentBotDoc & { _id: ObjectId }, input: ChatInput, args: Record<string, unknown>) {
    if (bot.propertyAgent.telegramId === null) return { ok: false, error: "Viewings cannot be booked yet: no Property Agent is linked to this bot. Tell the customer booking is unavailable right now." };
    if (!bot.datasetId) return { ok: false, error: "No Dataset is connected." };
    const listing = await getListing(store, bot.datasetId, String(args.listing_id ?? ""));
    if (!listing) return { ok: false, error: "That listing_id is not one of this bot's listings. Use an id from search_listings." };
    const at = parseViewingTime(String(args.date ?? ""), String(args.time ?? ""), defaultTimezone, now());
    if (!(at instanceof Date)) return { ok: false, error: at.error };
    const listingId = new ObjectId(listing.id);
    const customer = { channel: input.channel, chatId: input.chatId, name: input.customerName ?? null };
    const existing = await store.appointments.findOne({ botId: bot._id, listingId, "customer.channel": input.channel, "customer.chatId": input.chatId, scheduledFor: at, state: { $in: ["requested", "confirmed"] } });
    if (existing) return { ok: true, status: existing.state, note: "This request already exists." };
    const appointment: AppointmentDoc = {
      botId: bot._id, listingId, listingSummary: `${listing.unitType} in ${listing.location}`, customer, scheduledFor: at,
      state: "requested", agentNotifiedAt: null, locationPromptMessageId: null, createdAt: now(), decidedAt: null, locationSharedAt: null,
    };
    const { insertedId } = await store.appointments.insertOne(appointment);
    try { await hooks?.appointmentRequested?.({ ...appointment, _id: insertedId }, bot); } catch { /* notified on the bot's next start */ }
    return { ok: true, status: "requested", note: `Request sent for ${formatInstant(at, defaultTimezone)}. It is waiting for the Property Agent to confirm; tell the customer so.` };
  }

  return {
    async handleMessage(input: ChatInput): Promise<ChatReply> {
      const bot = await store.bots.findOne({ _id: input.botId });
      if (!bot) throw new EngineError("That Agent Bot does not exist.");
      const dataset = bot.datasetId ? await store.datasets.findOne({ _id: bot.datasetId }) : null;
      const searchable = dataset?.mapping && bot.datasetId;
      const [locations, unitTypes] = searchable
        ? await Promise.all([store.rows.distinct("location", { datasetId: bot.datasetId! }), store.rows.distinct("unitType", { datasetId: bot.datasetId! })])
        : [[], []];

      const messages: AgentChatMessage[] = [
        { role: "system", content: systemPrompt(bot, dataset, locations, unitTypes) },
        ...(await history(bot, input.channel, input.chatId, dataset)),
        { role: "user", content: input.text },
      ];
      const tools = [...(searchable ? [searchTool] : []), ...(bot.datasetId ? [bookTool] : [])];
      const askedAt = now();
      let shown: Listing[] = [];
      let text: string | null = null;

      for (let round = 0; round < MAX_ROUNDS && text === null; round++) {
        const reply = await llm({ messages, tools, ...(bot.persona.model ? { model: bot.persona.model } : {}), temperature: bot.persona.temperature });
        if (reply.toolCalls.length === 0) { text = reply.text ?? ""; break; }
        messages.push({
          role: "assistant", content: reply.text,
          tool_calls: reply.toolCalls.map((c) => ({ id: c.id, type: "function" as const, function: { name: c.name, arguments: c.arguments } })),
        });
        for (const call of reply.toolCalls) {
          let args: Record<string, unknown> = {};
          try { args = JSON.parse(call.arguments || "{}") as Record<string, unknown>; } catch { /* treated as no arguments */ }
          let result: unknown;
          if (call.name === "search_listings" && searchable) {
            const found = await runSearch(bot, args);
            shown = found.listings;
            result = found.result;
          } else if (call.name === "book_appointment" && bot.datasetId) result = await book(bot, input, args);
          else result = { error: `Unknown tool ${call.name}.` };
          messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result) });
        }
      }
      // Prices must come from the Dataset: a currency amount in the reply that no tool result or earlier listing contains is withheld.
      const known = messages.filter((m) => m.role === "tool" || m.role === "assistant" || m.role === "user").map((m) => (typeof m.content === "string" ? m.content : "")).join(" ").replace(/,/g, "");
      const amounts = [...(text ?? "").matchAll(/(?:AED|USD|Dhs?|\$)\s*(\d[\d,]*(?:\.\d+)?)|(\d[\d,]*(?:\.\d+)?)\s*(?:AED|USD|Dhs?)\b/gi)].map((m) => (m[1] ?? m[2] ?? "").replace(/,/g, ""));
      const invented = amounts.some((amount) => !new RegExp(`(?<![\\d.])${amount.replace(".", "\\.")}(?![\\d])`).test(known));
      if (invented) text = "Sorry, I can only quote prices from our listings. Tell me the area and unit type and I'll look them up.";
      const finalText = (text ?? "").trim() || "Sorry, I couldn't work that out. Could you say it another way?";
      await store.messages.insertMany([
        { botId: bot._id, channel: input.channel, chatId: input.chatId, role: "customer", text: input.text, listingIds: [], createdAt: askedAt },
        { botId: bot._id, channel: input.channel, chatId: input.chatId, role: "bot", text: finalText, listingIds: shown.map((l) => new ObjectId(l.id)), createdAt: new Date(askedAt.getTime() + 1) },
      ]);
      return { text: finalText, listings: shown };
    },

    /** Forgets one chat's history (the console's Reset); other chats and bots are untouched. */
    async resetChat(botId: ObjectId, channel: string, chatId: string): Promise<void> {
      await store.messages.deleteMany({ botId, channel, chatId });
    },
  };
}
