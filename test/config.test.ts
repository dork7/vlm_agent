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

  it("reads a complete environment", () => {
    const config = loadConfig(completeEnv);

    expect(config.openRouter.models).toEqual(["openai/gpt-4o-mini", "anthropic/claude-haiku"]);
    expect(config.firstAdmin).toEqual({ username: "owner", password: "s3cret", telegramId: "42" });
    expect(config.port).toBe(3000);
  });
});
