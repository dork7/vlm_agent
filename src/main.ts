import { ConfigError, loadConfig } from "./config.ts";
import { createCore } from "./core/core.ts";
import { connectDatabase } from "./db.ts";
import { createOpenRouter } from "./llm/openrouter.ts";
import { buildServer } from "./server.ts";
import { createTelegramBot } from "./telegram/adapter.ts";
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

  const database = await connectDatabase(config.mongo.uri, config.mongo.dbName);
  await ensureFirstAdmin(database, { ...config.firstAdmin, timezone: config.defaultTimezone });

  const core = createCore({
    database,
    llm: createOpenRouter(config.openRouter),
    defaultTimezone: config.defaultTimezone,
  });
  const bot = createTelegramBot(config.telegram.botToken, core);
  try {
    await bot.init();
  } catch (error) {
    console.error("Telegram rejected TELEGRAM_BOT_TOKEN:", error instanceof Error ? error.message : error);
    await database.close();
    process.exit(1);
  }
  const server = buildServer();

  const shutdown = async () => {
    await bot.stop();
    await server.close();
    await database.close();
    process.exit(0);
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);

  await server.listen({ port: config.port, host: "127.0.0.1" });
  // Long polling; resolves only when the bot stops.
  bot
    .start({ onStart: (me) => server.log.info(`Telegram bot @${me.username} polling`) })
    .catch((error) => {
      server.log.error(error, "Telegram polling stopped");
      process.exit(1);
    });
}

await main();
