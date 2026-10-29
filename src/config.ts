import { isValidTimezone } from "./time.ts";

export type Config = {
  port: number;
  defaultTimezone: string;
  markdownDir: string;
  telegram: { botToken: string };
  mongo: { uri: string; dbName: string };
  openRouter: { apiKey: string; baseUrl: string; models: string[] };
  firstAdmin: { username: string; password: string; telegramId: string };
};

const REQUIRED = [
  "TELEGRAM_BOT_TOKEN",
  "MONGODB_URI",
  "OPENROUTER_API_KEY",
  "OPENROUTER_MODELS",
  "ADMIN_USERNAME",
  "ADMIN_PASSWORD",
  "ADMIN_TELEGRAM_ID",
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
    defaultTimezone,
    markdownDir: value("MARKDOWN_DIR") ?? "./markdown",
    telegram: { botToken: required("TELEGRAM_BOT_TOKEN") },
    mongo: { uri: required("MONGODB_URI"), dbName: value("MONGODB_DB") ?? "voice_notes_bot" },
    openRouter: {
      apiKey: required("OPENROUTER_API_KEY"),
      baseUrl: value("OPENROUTER_BASE_URL") ?? "https://openrouter.ai/api/v1",
      models,
    },
    firstAdmin: {
      username: required("ADMIN_USERNAME"),
      password: required("ADMIN_PASSWORD"),
      telegramId: required("ADMIN_TELEGRAM_ID"),
    },
  };
}
