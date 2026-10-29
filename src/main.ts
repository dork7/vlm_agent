import { existsSync } from "node:fs";
import { ConfigError, loadConfig } from "./config.ts";
import { createCore } from "./core/core.ts";
import { connectDatabase } from "./db.ts";
import { createInventoryClient } from "./inventory/client.ts";
import { loadSeedItems } from "./inventory/items.ts";
import { createOpenRouter } from "./llm/openrouter.ts";
import { buildServer } from "./server.ts";
import { createWhisperTranscriber } from "./transcriber/transcriber.ts";
import { startReminderScheduler } from "./reminder-scheduler.ts";
import { createTelegramBot, sendTelegramReminder, telegramWebhookHandler } from "./telegram/adapter.ts";
import { ensureFirstAdmin } from "./users.ts";

async function main() {
  let config;
  try {
    config = loadConfig(process.env);
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error;
    console.error(error.message);
    process.exit(1);
  }
  if (!existsSync(config.transcriber.modelPath)) {
    console.error(
      `No whisper model at WHISPER_MODEL_PATH (${config.transcriber.modelPath}). ` +
        "Download one as shown in .env.example, or point WHISPER_MODEL_PATH at it.",
    );
    process.exit(1);
  }

  const database = await connectDatabase(config.mongo.uri, config.mongo.dbName);
  await ensureFirstAdmin(database, { ...config.firstAdmin, timezone: config.defaultTimezone });

  const core = createCore({
    database,
    llm: createOpenRouter(config.openRouter),
    inventory: createInventoryClient(config.inventory),
    transcriber: createWhisperTranscriber(config.transcriber),
    defaultTimezone: config.defaultTimezone,
    markdownDir: config.markdownDir,
  });
  const bot = createTelegramBot(config.telegram.botToken, core);
  try {
    await bot.init();
  } catch (error) {
    console.error("Telegram rejected TELEGRAM_BOT_TOKEN:", error instanceof Error ? error.message : error);
    await database.close();
    process.exit(1);
  }
  const { mode } = config.telegram;
  const server = buildServer({
    inventory: { items: loadSeedItems(), apiKey: config.inventory.apiKey },
    dashboard: { database, defaultTimezone: config.defaultTimezone, markdownDir: config.markdownDir },
    ...(mode.kind === "webhook"
      ? { webhook: { path: mode.path, handler: telegramWebhookHandler(bot, mode.secretToken) } }
      : {}),
  });

  // Each Channel's adapter renders the Reminders addressed to it; only Telegram exists so far.
  const stopReminders = startReminderScheduler(core, async (reminder) => {
    if (reminder.to.channel === "telegram") return sendTelegramReminder(bot, reminder);
    console.warn(`No adapter for Channel ${reminder.to.channel}; Reminder for Task ${reminder.taskId} not sent`);
  });

  const shutdown = async () => {
    stopReminders();
    // In webhook mode the webhook stays registered, so Telegram keeps updates until the bot is back.
    if (mode.kind === "polling") await bot.stop();
    await server.close();
    await database.close();
    process.exit(0);
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);

  await server.listen({ port: config.port, host: config.host });

  if (mode.kind === "webhook") {
    await bot.api.setWebhook(mode.url, { secret_token: mode.secretToken });
    server.log.info(`Telegram bot @${bot.botInfo.username} receiving updates at ${mode.url}`);
    return;
  }
  // Long polling, which first removes any registered webhook; resolves only when the bot stops.
  bot
    .start({ onStart: (me) => server.log.info(`Telegram bot @${me.username} polling`) })
    .catch((error) => {
      server.log.error(error, "Telegram polling stopped");
      process.exit(1);
    });
}

await main();
