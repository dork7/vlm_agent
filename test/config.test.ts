import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.ts";

const completeEnv = {
  TELEGRAM_BOT_TOKEN: "123:abc",
  MONGODB_URI: "mongodb://localhost:27017",
  OPENROUTER_API_KEY: "or-key",
  OPENROUTER_MODELS: "openai/gpt-4o-mini, anthropic/claude-haiku",
  ADMIN_USERNAME: "owner",
  ADMIN_PASSWORD: "s3cret",
  ADMIN_TELEGRAM_ID: "42",
  INVENTORY_API_KEY: "inv-key",
};

describe("startup configuration", () => {
  it("fails naming every missing required environment variable", () => {
    const { MONGODB_URI, ADMIN_PASSWORD, ...env } = completeEnv;

    expect(() => loadConfig(env)).toThrow(
      "Missing required environment variables: MONGODB_URI, ADMIN_PASSWORD",
    );
  });

  it("treats a blank value as missing", () => {
    expect(() => loadConfig({ ...completeEnv, TELEGRAM_BOT_TOKEN: "  " })).toThrow(
      "Missing required environment variables: TELEGRAM_BOT_TOKEN",
    );
  });

  it("fails naming OPENROUTER_MODELS when it lists no models", () => {
    expect(() => loadConfig({ ...completeEnv, OPENROUTER_MODELS: " , " })).toThrow(
      "OPENROUTER_MODELS must list at least one model",
    );
  });

  it("fails on a DEFAULT_TIMEZONE that is not a known timezone", () => {
    expect(() => loadConfig({ ...completeEnv, DEFAULT_TIMEZONE: "Mars/Olympus" })).toThrow(
      'DEFAULT_TIMEZONE must be an IANA timezone such as "Asia/Dubai", got "Mars/Olympus"',
    );
  });

  it("defaults the timezone to UTC", () => {
    expect(loadConfig(completeEnv).defaultTimezone).toBe("UTC");
    expect(loadConfig({ ...completeEnv, DEFAULT_TIMEZONE: "Asia/Dubai" }).defaultTimezone).toBe("Asia/Dubai");
  });

  it("defaults the Markdown folder to ./markdown", () => {
    expect(loadConfig(completeEnv).markdownDir).toBe("./markdown");
    expect(loadConfig({ ...completeEnv, MARKDOWN_DIR: "/tmp/vault" }).markdownDir).toBe("/tmp/vault");
  });

  it("requires an Inventory API key and defaults the Inventory to this app's own routes", () => {
    const { INVENTORY_API_KEY, ...env } = completeEnv;
    expect(() => loadConfig(env)).toThrow("Missing required environment variables: INVENTORY_API_KEY");

    expect(loadConfig({ ...completeEnv, PORT: "4000" }).inventory).toEqual({
      baseUrl: "http://127.0.0.1:4000/inventory",
      apiKey: "inv-key",
    });
    expect(loadConfig({ ...completeEnv, INVENTORY_BASE_URL: "https://stock.example.com/api" }).inventory.baseUrl).toBe(
      "https://stock.example.com/api",
    );
  });

  it("defaults the Transcriber to small.en in ./models and the programs on the PATH", () => {
    expect(loadConfig(completeEnv).transcriber).toEqual({
      ffmpegPath: "ffmpeg",
      whisperPath: "whisper-cli",
      modelPath: "./models/ggml-small.en.bin",
    });
    expect(loadConfig({ ...completeEnv, WHISPER_MODEL_PATH: "/opt/ggml-base.en.bin" }).transcriber.modelPath).toBe(
      "/opt/ggml-base.en.bin",
    );
  });

  it("reads a complete environment", () => {
    const config = loadConfig(completeEnv);

    expect(config.openRouter.models).toEqual(["openai/gpt-4o-mini", "anthropic/claude-haiku"]);
    expect(config.firstAdmin).toEqual({ username: "owner", password: "s3cret", telegramId: "42" });
    expect(config.port).toBe(3000);
  });
});
