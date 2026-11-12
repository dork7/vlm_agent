import { ConfigError } from "../config.ts";

/** The LiveKit server the Voice page and the voice agent both connect to. */
export type LiveKitConfig = {
  /** ws:// or wss:// URL the browser and the agent connect to. */
  url: string;
  apiKey: string;
  apiSecret: string;
};

/** The name the voice agent registers under; each Voice room's token asks LiveKit to dispatch it. */
export const VOICE_AGENT_NAME = "voice-assistant";

/** What the voice agent runs on: whisper.cpp to hear, and a local OpenAI-compatible server to think and speak. */
export type VoiceAgentConfig = {
  livekit: LiveKitConfig;
  stt: { whisperPath: string; modelPath: string };
  /** Sent to the model as reasoning_effort; when absent the field is left out of requests. */
  llm: { baseUrl: string; model: string; reasoningEffort?: ReasoningEffort };
  tts: { baseUrl: string; model: string; voice: string; sampleRate: number };
};

type Env = Record<string, string | undefined>;

const REASONING_EFFORTS = ["none", "minimal", "low", "medium", "high"] as const;
export type ReasoningEffort = (typeof REASONING_EFFORTS)[number];

const LIVEKIT_VARIABLES = ["LIVEKIT_URL", "LIVEKIT_API_KEY", "LIVEKIT_API_SECRET"] as const;

/** The LiveKit server, or null when none is configured, which turns the Voice page off. */
export function loadLiveKitConfig(env: Env): LiveKitConfig | null {
  const value = valueOf(env);
  const set = LIVEKIT_VARIABLES.filter((name) => value(name) !== undefined);
  if (set.length === 0) return null;
  const missing = LIVEKIT_VARIABLES.filter((name) => value(name) === undefined);
  if (missing.length > 0) {
    throw new ConfigError(`The Voice page needs all of LIVEKIT_URL, LIVEKIT_API_KEY and LIVEKIT_API_SECRET; missing: ${missing.join(", ")}`);
  }

  const url = value("LIVEKIT_URL")!;
  let protocol;
  try {
    protocol = new URL(url).protocol;
  } catch {
    protocol = "";
  }
  if (protocol !== "ws:" && protocol !== "wss:") {
    throw new ConfigError(`LIVEKIT_URL must be a ws:// or wss:// URL, got "${url}"`);
  }
  return { url, apiKey: value("LIVEKIT_API_KEY")!, apiSecret: value("LIVEKIT_API_SECRET")! };
}

/** Everything the voice agent process needs; it never touches Telegram or MongoDB. */
export function loadVoiceAgentConfig(env: Env): VoiceAgentConfig {
  const value = valueOf(env);
  const livekit = loadLiveKitConfig(env);
  if (!livekit) throw new ConfigError("The voice agent needs LIVEKIT_URL, LIVEKIT_API_KEY and LIVEKIT_API_SECRET");

  const missing = ["VOICE_LLM_MODEL", "VOICE_TTS_MODEL"].filter((name) => value(name) === undefined);
  if (missing.length > 0) throw new ConfigError(`The voice agent also needs: ${missing.join(", ")}`);

  const baseUrl = (value("VOICE_BASE_URL") ?? value("LOCAL_LLM_BASE_URL") ?? "http://localhost:8080/v1").replace(/\/+$/, "");
  try {
    if (!/^https?:$/.test(new URL(baseUrl).protocol)) throw new Error();
  } catch {
    throw new ConfigError(`VOICE_BASE_URL must be an http:// or https:// URL, got "${baseUrl}"`);
  }

  const sampleRate = Number(value("VOICE_TTS_SAMPLE_RATE") ?? 22050);
  if (!Number.isInteger(sampleRate) || sampleRate < 8000) {
    throw new ConfigError(`VOICE_TTS_SAMPLE_RATE must be a whole number of Hz, at least 8000, got "${env.VOICE_TTS_SAMPLE_RATE}"`);
  }

  // "none" by default: a spoken reply can't wait on thinking, and some local thinking models (Gemma 4 on
  // LocalAI) otherwise often put the whole answer in their reasoning, leaving nothing to say. "omit" sends none.
  const effort = value("VOICE_LLM_REASONING_EFFORT") ?? "none";
  if (effort !== "omit" && !(REASONING_EFFORTS as readonly string[]).includes(effort)) {
    throw new ConfigError(`VOICE_LLM_REASONING_EFFORT must be one of ${REASONING_EFFORTS.join(", ")} or omit, got "${effort}"`);
  }

  return {
    livekit,
    stt: {
      whisperPath: value("WHISPER_CLI_PATH") ?? "whisper-cli",
      modelPath: value("WHISPER_MODEL_PATH") ?? "./models/ggml-small.en.bin",
    },
    llm: {
      baseUrl,
      model: value("VOICE_LLM_MODEL")!,
      ...(effort === "omit" ? {} : { reasoningEffort: effort as ReasoningEffort }),
    },
    tts: { baseUrl, model: value("VOICE_TTS_MODEL")!, voice: value("VOICE_TTS_VOICE") ?? "", sampleRate },
  };
}

function valueOf(env: Env) {
  return (name: string) => env[name]?.trim() || undefined;
}
