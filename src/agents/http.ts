import { readdir, readFile } from "node:fs/promises";
import { extname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomInt } from "node:crypto";
import ejs from "ejs";
import type { FastifyPluginAsync, FastifyReply } from "fastify";
import { ObjectId } from "mongodb";
import { authenticate } from "../dashboard/auth.ts";
import { badRequest, field, notFound, parseId, type Form } from "../dashboard/http.ts";
import type { Database, UserDoc } from "../db.ts";
import { formatInstant } from "../time.ts";
import { DatasetError, guessMapping, importDataset, insideFolder, parseDatasetText, saveUpload, validateMapping } from "./dataset.ts";
import type { Engine } from "./engine.ts";
import type { BotManager } from "./telegram.ts";
import { APPOINTMENT_STATES, DEFAULT_PERSONA, FIELD_ROLES, type AgentBotDoc, type AgentsStore, type FieldMapping } from "./types.ts";

const VIEWS = fileURLToPath(new URL("./views/", import.meta.url));
const IMAGE_TYPES: Record<string, string> = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".gif": "image/gif" };
const PAGE_SIZE = 20;
const LINK_CODE_MINUTES = 15;

export type AgentsOptions = {
  database: Database;
  store: AgentsStore;
  engine: Pick<Engine, "handleMessage" | "resetChat">;
  /** Runs the bots on Telegram; without it the console can still define bots and test chat. */
  manager?: BotManager;
  datasetDir: string;
  defaultTimezone: string;
  now?: () => Date;
};

declare module "fastify" {
  interface FastifyInstance {
    /** Whether the Agents console exists, for the dashboard nav. */
    agentsPage: boolean;
  }
}

/** The token with all but its last four characters hidden. */
export function maskToken(token: string): string {
  return token ? `••••••••${token.slice(-4)}` : "";
}

export const agentsRoutes: FastifyPluginAsync<AgentsOptions> = async (app, options) => {
  const { database, store, engine, manager, datasetDir, defaultTimezone, now = () => new Date() } = options;

  app.decorateRequest("user", null as unknown as UserDoc);
  app.addContentTypeParser("application/x-www-form-urlencoded", { parseAs: "string" }, (_request, body, done) => {
    done(null, Object.fromEntries(new URLSearchParams(body as string)));
  });

  // Same login as the dashboard: explicit credentials pick the User; none opens as the first admin.
  app.addHook("onRequest", async (request, reply) => {
    const header = request.headers.authorization;
    const user = header === undefined
      ? await database.users.findOne({}, { sort: { isAdmin: -1, createdAt: 1, _id: 1 } })
      : await authenticate(database, header);
    if (!user) {
      return reply.code(header === undefined ? 503 : 401).type("text/plain").send(header === undefined ? "No dashboard User is configured yet." : "Invalid user credentials.");
    }
    request.user = user;
  });

  const page = async (reply: FastifyReply, view: string, data: Record<string, unknown>, code = 200) => {
    const html = await ejs.renderFile(`${VIEWS}${view}.ejs`, {
      activeSection: "agents", viewer: reply.request.user, voicePage: reply.server.voicePage === true, agentsPage: true,
      shown: (d: Date) => formatInstant(d, defaultTimezone), mask: maskToken, errors: [] as string[], ...data,
    });
    return reply.code(code).type("text/html; charset=utf-8").send(html);
  };

  const ownBot = async (id: string) => {
    const _id = parseId(id);
    return _id ? ((await store.bots.findOne({ _id })) as (AgentBotDoc & { _id: ObjectId }) | null) : null;
  };
  const statusOf = (bot: AgentBotDoc & { _id: ObjectId }) => manager?.status(bot._id) ?? { state: bot.enabled ? "running" : "stopped" as const };

  async function datasetFiles() {
    try { return (await readdir(datasetDir)).filter((f) => [".csv", ".json"].includes(extname(f).toLowerCase())).sort(); } catch { return []; }
  }

  // ---- Bots ----
  app.get("/", async (_request, reply) => {
    const [bots, datasets] = await Promise.all([store.bots.find().sort({ createdAt: -1 }).toArray(), store.datasets.find().sort({ importedAt: -1 }).toArray()]);
    return page(reply, "index", { bots, datasets, statusOf, datasetName: (id: ObjectId | null) => datasets.find((d) => id && d._id.equals(id))?.name ?? "–" });
  });

  const botForm = async (reply: FastifyReply, bot: Partial<AgentBotDoc> & { token?: string }, extra: { isNew: boolean; errors?: string[]; id?: string }, code = 200) => {
    const datasets = await store.datasets.find().sort({ name: 1 }).toArray();
    return page(reply, "bot", { bot, datasets, ...extra, status: extra.id ? statusOf(bot as AgentBotDoc & { _id: ObjectId }) : { state: "stopped" }, manager: manager !== undefined }, code);
  };

  app.get("/bots/new", async (_request, reply) => botForm(reply, { name: "", guide: "", persona: DEFAULT_PERSONA, datasetId: null }, { isNew: true }));

  /** Reads and checks the bot form; the bot to save, or the problems to show with the input kept. */
  function readBotForm(body: Form, existing: AgentBotDoc | null) {
    const errors: string[] = [];
    const name = field(body, "name");
    if (!name) errors.push("Give the bot a name.");
    const token = field(body, "token") || existing?.token || "";
    if (!token) errors.push("Enter the Telegram token from BotFather.");
    else if (!/^\d+:[\w-]{10,}$/.test(token)) errors.push("That does not look like a Telegram bot token (expected 123456:ABC...).");
    const temperature = Number(field(body, "temperature") || DEFAULT_PERSONA.temperature);
    if (!Number.isFinite(temperature) || temperature < 0 || temperature > 2) errors.push("Temperature must be between 0 and 2.");
    const maxResults = Number(field(body, "maxResults") || DEFAULT_PERSONA.maxResults);
    if (!Number.isInteger(maxResults) || maxResults < 1 || maxResults > 10) errors.push("Max results per reply must be a whole number from 1 to 10.");
    const datasetRaw = field(body, "datasetId");
    const datasetId = datasetRaw ? parseId(datasetRaw) : null;
    if (datasetRaw && !datasetId) errors.push("Choose a Dataset from the list.");
    return {
      errors,
      values: {
        name, token, datasetId, guide: (body?.guide ?? "").replace(/\r\n/g, "\n"),
        persona: {
          tone: field(body, "tone") || DEFAULT_PERSONA.tone, language: field(body, "language") || DEFAULT_PERSONA.language,
          model: field(body, "model"), temperature, maxResults,
        },
      },
    };
  }

  app.post<{ Body: Form }>("/bots", async (request, reply) => {
    const { errors, values } = readBotForm(request.body, null);
    if (values.datasetId && !(await store.datasets.findOne({ _id: values.datasetId }))) errors.push("That Dataset does not exist.");
    if (errors.length) return botForm(reply, { ...values, token: "" }, { isNew: true, errors }, 400);
    const at = now();
    const { insertedId } = await store.bots.insertOne({
      ...values, enabled: false, createdAt: at, updatedAt: at,
      propertyAgent: { telegramId: null, name: null, linkCode: null, linkCodeExpiresAt: null },
    });
    return reply.redirect(`/agents/bots/${insertedId}`, 303);
  });

  app.get<{ Params: { id: string }; Querystring: { saved?: string } }>("/bots/:id", async (request, reply) => {
    const bot = await ownBot(request.params.id);
    if (!bot) return notFound(reply);
    const linkLive = bot.propertyAgent.linkCode !== null && (bot.propertyAgent.linkCodeExpiresAt?.getTime() ?? 0) > now().getTime();
    return page(reply, "bot", {
      bot, datasets: await store.datasets.find().sort({ name: 1 }).toArray(), isNew: false, id: String(bot._id), status: statusOf(bot),
      manager: manager !== undefined, linkLive, saved: request.query.saved === "1",
    });
  });

  app.post<{ Params: { id: string }; Body: Form }>("/bots/:id", async (request, reply) => {
    const bot = await ownBot(request.params.id);
    if (!bot) return notFound(reply);
    const { errors, values } = readBotForm(request.body, bot);
    if (values.datasetId && !(await store.datasets.findOne({ _id: values.datasetId }))) errors.push("That Dataset does not exist.");
    if (errors.length) return botForm(reply, { ...bot, ...values, token: bot.token }, { isNew: false, errors, id: String(bot._id) }, 400);
    await store.bots.updateOne({ _id: bot._id }, { $set: { ...values, updatedAt: now() } });
    // Only the token needs the Telegram connection rebuilt; the rest is read fresh on each message.
    if (values.token !== bot.token) await manager?.reload(bot._id);
    return reply.redirect(`/agents/bots/${bot._id}?saved=1`, 303);
  });

  app.post<{ Params: { id: string } }>("/bots/:id/delete", async (request, reply) => {
    const bot = await ownBot(request.params.id);
    if (!bot) return notFound(reply);
    await manager?.stop(bot._id);
    await Promise.all([store.bots.deleteOne({ _id: bot._id }), store.messages.deleteMany({ botId: bot._id }), store.appointments.deleteMany({ botId: bot._id })]);
    return reply.redirect("/agents", 303);
  });

  for (const action of ["start", "stop"] as const) {
    app.post<{ Params: { id: string } }>(`/bots/:id/${action}`, async (request, reply) => {
      const bot = await ownBot(request.params.id);
      if (!bot) return notFound(reply);
      if (!manager) return badRequest(reply, "Telegram bots are not enabled in this app.");
      if (action === "start") await manager.start(bot._id); else await manager.stop(bot._id);
      return reply.redirect(`/agents/bots/${bot._id}`, 303);
    });
  }

  app.post<{ Params: { id: string } }>("/bots/:id/link-code", async (request, reply) => {
    const bot = await ownBot(request.params.id);
    if (!bot) return notFound(reply);
    const code = Array.from({ length: 6 }, () => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[randomInt(32)]).join("");
    await store.bots.updateOne({ _id: bot._id }, { $set: { "propertyAgent.linkCode": code, "propertyAgent.linkCodeExpiresAt": new Date(now().getTime() + LINK_CODE_MINUTES * 60_000) } });
    return reply.redirect(`/agents/bots/${bot._id}`, 303);
  });

  app.post<{ Params: { id: string } }>("/bots/:id/unlink", async (request, reply) => {
    const bot = await ownBot(request.params.id);
    if (!bot) return notFound(reply);
    await store.bots.updateOne({ _id: bot._id }, { $set: { "propertyAgent": { telegramId: null, name: null, linkCode: null, linkCodeExpiresAt: null } } });
    return reply.redirect(`/agents/bots/${bot._id}`, 303);
  });

  // ---- Test chat (no Telegram) ----
  app.post<{ Params: { id: string }; Body: { text?: unknown } }>("/bots/:id/test-chat", async (request, reply) => {
    const bot = await ownBot(request.params.id);
    if (!bot) return notFound(reply);
    const text = typeof request.body?.text === "string" ? request.body.text.trim() : "";
    if (!text) return badRequest(reply, "Type a message first.");
    try {
      const result = await engine.handleMessage({ botId: bot._id, channel: "console", chatId: String(request.user._id), text, customerName: request.user.username });
      return { text: result.text, listings: result.listings };
    } catch (error) {
      app.log.error(error, "Test chat failed");
      return reply.code(502).send({ error: "The model could not answer. Check the OpenRouter key and models, then try again." });
    }
  });

  app.post<{ Params: { id: string } }>("/bots/:id/test-chat/reset", async (request, reply) => {
    const bot = await ownBot(request.params.id);
    if (!bot) return notFound(reply);
    await engine.resetChat(bot._id, "console", String(request.user._id));
    return { ok: true };
  });

  // ---- Chat logs ----
  app.get<{ Params: { id: string }; Querystring: { page?: string; chat?: string } }>("/bots/:id/logs", async (request, reply) => {
    const bot = await ownBot(request.params.id);
    if (!bot) return notFound(reply);
    const pageNumber = Math.max(1, Math.floor(Number(request.query.page)) || 1);
    const chat = request.query.chat?.trim() ?? "";
    const filter = { botId: bot._id, ...(chat ? { chatId: chat } : {}) };
    const [total, messages, chats] = await Promise.all([
      store.messages.countDocuments(filter),
      store.messages.find(filter).sort({ createdAt: -1, _id: -1 }).skip((pageNumber - 1) * PAGE_SIZE).limit(PAGE_SIZE).toArray(),
      store.messages.aggregate<{ _id: { channel: string; chatId: string }; count: number; last: Date }>([
        { $match: { botId: bot._id } }, { $group: { _id: { channel: "$channel", chatId: "$chatId" }, count: { $sum: 1 }, last: { $max: "$createdAt" } } }, { $sort: { last: -1 } }, { $limit: 50 },
      ]).toArray(),
    ]);
    const ids = messages.flatMap((m) => m.listingIds);
    const rows = ids.length ? await store.rows.find({ _id: { $in: ids } }).toArray() : [];
    const dataset = bot.datasetId ? await store.datasets.findOne({ _id: bot.datasetId }) : null;
    const listingLabel = (id: ObjectId) => {
      const row = rows.find((r) => r._id.equals(id));
      return row ? `${row.location} · ${row.unitType} · ${dataset?.mapping ? row.data[dataset.mapping.price] : row.price}` : "(listing removed)";
    };
    return page(reply, "logs", { bot, messages, chats, chat, total, pageNumber, pages: Math.max(1, Math.ceil(total / PAGE_SIZE)), listingLabel });
  });

  // ---- Appointments ----
  app.get<{ Params: { id: string }; Querystring: { state?: string } }>("/bots/:id/appointments", async (request, reply) => {
    const bot = await ownBot(request.params.id);
    if (!bot) return notFound(reply);
    const state = (APPOINTMENT_STATES as readonly string[]).includes(request.query.state ?? "") ? request.query.state! : "";
    const appointments = await store.appointments.find({ botId: bot._id, ...(state ? { state: state as never } : {}) }).sort({ createdAt: -1, _id: -1 }).limit(200).toArray();
    return page(reply, "appointments", { bot, appointments, state, states: APPOINTMENT_STATES });
  });

  // ---- Datasets ----
  app.get("/datasets/new", async (_request, reply) => page(reply, "dataset-new", { files: await datasetFiles(), values: { name: "" } }));

  app.post<{ Body: Form }>("/datasets", { bodyLimit: 10 * 1024 * 1024 }, async (request, reply) => {
    const name = field(request.body, "name");
    const existing = field(request.body, "existing");
    const filename = field(request.body, "filename");
    const content = request.body?.content ?? "";
    const fail = async (message: string) => page(reply, "dataset-new", { files: await datasetFiles(), values: { name }, errors: [message] }, 400);
    try {
      let sourceFile = existing;
      if (!sourceFile) {
        if (!content.trim()) return fail("Choose a file in the dataset folder, or upload a CSV or JSON file.");
        sourceFile = await saveUpload(datasetDir, filename || "dataset.csv", content);
      }
      const dataset = await importDataset({ store, datasetDir, sourceFile, ...(name ? { name } : {}), now });
      return reply.redirect(`/agents/datasets/${dataset._id}`, 303);
    } catch (error) {
      if (error instanceof DatasetError) return fail(error.message);
      throw error;
    }
  });

  async function datasetPage(reply: FastifyReply, id: string, extra: { errors?: string[]; selected?: Partial<FieldMapping>; code?: number; imported?: boolean } = {}) {
    const _id = parseId(id);
    const dataset = _id ? await store.datasets.findOne({ _id }) : null;
    if (!dataset) return notFound(reply);
    let preview: Record<string, string>[] = [];
    let fields = dataset.fields;
    let fileError = "";
    try {
      const parsed = parseDatasetText(await readFile(insideFolder(datasetDir, dataset.sourceFile) ?? "", "utf8"), dataset.sourceFile);
      preview = parsed.records.slice(0, 10);
      fields = parsed.fields;
    } catch (error) {
      fileError = error instanceof Error ? error.message : "The source file could not be read.";
    }
    const bots = await store.bots.find({ datasetId: dataset._id }).toArray();
    return page(reply, "dataset", {
      dataset, preview, fields, fileError, roles: FIELD_ROLES, bots, imported: extra.imported === true,
      selected: extra.selected ?? dataset.mapping ?? guessMapping(fields), errors: extra.errors ?? [],
    }, extra.code ?? 200);
  }

  app.get<{ Params: { id: string }; Querystring: { imported?: string } }>("/datasets/:id", async (request, reply) => datasetPage(reply, request.params.id, { imported: request.query.imported === "1" }));

  app.post<{ Params: { id: string }; Body: Form }>("/datasets/:id/mapping", async (request, reply) => {
    const _id = parseId(request.params.id);
    const dataset = _id ? await store.datasets.findOne({ _id }) : null;
    if (!dataset || !_id) return notFound(reply);
    const selected = Object.fromEntries(FIELD_ROLES.map((role) => [role, field(request.body, role)])) as Partial<FieldMapping>;
    const checked = validateMapping(dataset.fields, selected);
    if (!checked.ok) return datasetPage(reply, request.params.id, { errors: checked.problems, selected, code: 400 });
    try {
      await importDataset({ store, datasetDir, sourceFile: dataset.sourceFile, mapping: checked.mapping, datasetId: _id, now });
    } catch (error) {
      if (error instanceof DatasetError) return datasetPage(reply, request.params.id, { errors: [error.message], selected, code: 400 });
      throw error;
    }
    return reply.redirect(`/agents/datasets/${_id}?imported=1`, 303);
  });

  app.post<{ Params: { id: string } }>("/datasets/:id/reimport", async (request, reply) => {
    const _id = parseId(request.params.id);
    const dataset = _id ? await store.datasets.findOne({ _id }) : null;
    if (!dataset || !_id) return notFound(reply);
    try {
      await importDataset({ store, datasetDir, sourceFile: dataset.sourceFile, datasetId: _id, now });
    } catch (error) {
      if (error instanceof DatasetError) return datasetPage(reply, request.params.id, { errors: [error.message], code: 400 });
      throw error;
    }
    return reply.redirect(`/agents/datasets/${_id}?imported=1`, 303);
  });

  app.post<{ Params: { id: string } }>("/datasets/:id/delete", async (request, reply) => {
    const _id = parseId(request.params.id);
    const dataset = _id ? await store.datasets.findOne({ _id }) : null;
    if (!dataset || !_id) return notFound(reply);
    if (await store.bots.countDocuments({ datasetId: _id })) return datasetPage(reply, request.params.id, { errors: ["A bot still uses this Dataset. Change the bot's Dataset first."], code: 400 });
    await Promise.all([store.datasets.deleteOne({ _id }), store.rows.deleteMany({ datasetId: _id })]);
    return reply.redirect("/agents", 303);
  });

  // ---- Listing images, from the dataset folder only ----
  app.get<{ Params: { "*": string } }>("/files/*", async (request, reply) => {
    const relative = request.params["*"];
    const type = IMAGE_TYPES[extname(relative).toLowerCase()];
    const path = insideFolder(datasetDir, relative);
    if (!type || !path || !relative.startsWith("images/")) return notFound(reply);
    try {
      return reply.type(type).header("cache-control", "private, max-age=300").send(await readFile(path));
    } catch {
      return notFound(reply);
    }
  });
};
