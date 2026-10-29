import { isValidTimezone } from "./time.ts";

export type Config = {
  port: number;
  /** Interface the server listens on; 127.0.0.1 unless something outside must reach it, such as Telegram's webhook. */
  host: string;
  defaultTimezone: string;
  markdownDir: string;
  telegram: { botToken: string; mode: TelegramMode };
  mongo: { uri: string; dbName: string };
  openRouter: { apiKey: string; baseUrl: string; models: string[] };
  /** The Inventory API the model's tools call over HTTP (ADR 0002), and the key this app's own one accepts. */
  inventory: { baseUrl: string; apiKey: string };
  transcriber: { ffmpegPath: string; whisperPath: string; modelPath: string };
  firstAdmin: { username: string; password: string; telegramId: string };
};

/** How Telegram updates reach the bot: long polling, or Telegram posting them to a public HTTPS URL. */
export type TelegramMode =
  | { kind: "polling" }
  | { kind: "webhook"; url: string; path: string; secretToken: string };

const REQUIRED = [
  "TELEGRAM_BOT_TOKEN",
  "MONGODB_URI",
  "OPENROUTER_API_KEY",
  "OPENROUTER_MODELS",
  "ADMIN_USERNAME",
  "ADMIN_PASSWORD",
  "ADMIN_TELEGRAM_ID",
  "INVENTORY_API_KEY",
] as const;

export class ConfigError extends Error {}

export function loadConfig(env: Record<string, string | undefined>): Config {
  const value = (name: string) => env[name]?.trim() || undefined;

  const missing = REQUIRED.filter((name) => value(name) === undefined);
  if (missing.length > 0) {
    throw new ConfigError(`Missing required environment variables: ${missing.join(", ")}`);
  }
  const required = (name: (typeof REQUIRED)[number]) => value(name)!;

  const models = required("OPENROUTER_MODELS")
    .split(",")
    .map((model) => model.trim())
    .filter(Boolean);
  if (models.length === 0) {
    throw new ConfigError("OPENROUTER_MODELS must list at least one model");
  }

  const port = Number(value("PORT") ?? 3000);
  if (!Number.isInteger(port) || port <= 0) {
    throw new ConfigError(`PORT must be a positive integer, got "${env.PORT}"`);
  }

  const defaultTimezone = value("DEFAULT_TIMEZONE") ?? "UTC";
  if (!isValidTimezone(defaultTimezone)) {
    throw new ConfigError(
      `DEFAULT_TIMEZONE must be an IANA timezone such as "Asia/Dubai", got "${defaultTimezone}"`,
    );
  }

  return {
    port,
    host: value("HOST") ?? "127.0.0.1",
    defaultTimezone,
    markdownDir: value("MARKDOWN_DIR") ?? "./markdown",
    telegram: { botToken: required("TELEGRAM_BOT_TOKEN"), mode: telegramMode(value) },
    mongo: { uri: required("MONGODB_URI"), dbName: value("MONGODB_DB") ?? "voice_notes_bot" },
    openRouter: {
      apiKey: required("OPENROUTER_API_KEY"),
      baseUrl: value("OPENROUTER_BASE_URL") ?? "https://openrouter.ai/api/v1",
      models,
    },
    inventory: {
      baseUrl: value("INVENTORY_BASE_URL") ?? `http://127.0.0.1:${port}/inventory`,
      apiKey: required("INVENTORY_API_KEY"),
    },
    transcriber: {
      ffmpegPath: value("FFMPEG_PATH") ?? "ffmpeg",
      whisperPath: value("WHISPER_CLI_PATH") ?? "whisper-cli",
      modelPath: value("WHISPER_MODEL_PATH") ?? "./models/ggml-small.en.bin",
    },
    firstAdmin: {
      username: required("ADMIN_USERNAME"),
      password: required("ADMIN_PASSWORD"),
      telegramId: required("ADMIN_TELEGRAM_ID"),
    },
  };
}

function telegramMode(value: (name: string) => string | undefined): TelegramMode {
  const mode = value("BOT_MODE") ?? "polling";
  if (mode === "polling") return { kind: "polling" };
  if (mode !== "webhook") throw new ConfigError(`BOT_MODE must be "polling" or "webhook", got "${mode}"`);

  const missing = ["WEBHOOK_URL", "TELEGRAM_WEBHOOK_SECRET"].filter((name) => value(name) === undefined);
  if (missing.length > 0) throw new ConfigError(`BOT_MODE=webhook also needs: ${missing.join(", ")}`);
  const url = value("WEBHOOK_URL")!;
  const secretToken = value("TELEGRAM_WEBHOOK_SECRET")!;

  let path;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") throw new Error();
    path = parsed.pathname;
  } catch {
    throw new ConfigError(`WEBHOOK_URL must be an https:// URL, got "${url}"`);
  }
  // Telegram's own rule for the secret it sends back in each webhook request.
  if (!/^[A-Za-z0-9_-]{1,256}$/.test(secretToken)) {
    throw new ConfigError("TELEGRAM_WEBHOOK_SECRET may use only A-Z, a-z, 0-9, _ and -, up to 256 characters");
  }
  return { kind: "webhook", url, path, secretToken };
}
