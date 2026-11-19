import { describe, expect, it } from "vitest";
import { ConfigError } from "../src/config.ts";
import { loadLiveKitConfig, loadVoiceAgentConfig } from "../src/voice/config.ts";

const LIVEKIT = { LIVEKIT_URL: "ws://localhost:7880", LIVEKIT_API_KEY: "devkey", LIVEKIT_API_SECRET: "secret" };
const AGENT = { ...LIVEKIT, VOICE_LLM_MODEL: "gemma-4-e2b-it", VOICE_TTS_MODEL: "vits-ljs-sherpa" };

describe("the Voice page's LiveKit configuration", () => {
  it("is off when no LiveKit server is configured", () => {
    expect(loadLiveKitConfig({})).toBeNull();
    expect(loadLiveKitConfig({ LIVEKIT_URL: " ", LIVEKIT_API_KEY: "" })).toBeNull();
  });

  it("is the LiveKit server when all three variables are set", () => {
    expect(loadLiveKitConfig(LIVEKIT)).toEqual({ url: "ws://localhost:7880", apiKey: "devkey", apiSecret: "secret" });
    expect(loadLiveKitConfig({ ...LIVEKIT, LIVEKIT_URL: "wss://voice.example.com" })?.url).toBe("wss://voice.example.com");
  });

  it("names what is missing when only some are set", () => {
    expect(() => loadLiveKitConfig({ LIVEKIT_URL: "ws://localhost:7880" })).toThrow(
      new ConfigError(
        "The Voice page needs all of LIVEKIT_URL, LIVEKIT_API_KEY and LIVEKIT_API_SECRET; missing: LIVEKIT_API_KEY, LIVEKIT_API_SECRET",
      ),
    );
  });

  it("refuses a URL the browser can't open a LiveKit connection to", () => {
    for (const url of ["http://localhost:7880", "localhost:7880"]) {
      expect(() => loadLiveKitConfig({ ...LIVEKIT, LIVEKIT_URL: url })).toThrow(/LIVEKIT_URL must be a ws:\/\/ or wss:\/\/ URL/);
    }
  });
});

describe("the voice agent's configuration", () => {
  it("runs on the local model server and whisper.cpp by default", () => {
    expect(loadVoiceAgentConfig(AGENT)).toEqual({
      livekit: { url: "ws://localhost:7880", apiKey: "devkey", apiSecret: "secret" },
      stt: { whisperPath: "whisper-cli", modelPath: "./models/ggml-small.en.bin" },
      llm: { baseUrl: "http://localhost:8080/v1", model: "gemma-4-e2b-it", reasoningEffort: "none" },
      tts: { baseUrl: "http://localhost:8080/v1", model: "vits-ljs-sherpa", voice: "", sampleRate: 22050 },
    });
  });

  it("uses the same local model server as the bot, unless given its own", () => {
    const shared = loadVoiceAgentConfig({ ...AGENT, LOCAL_LLM_BASE_URL: "http://127.0.0.1:9000/v1/" });
    expect(shared.llm.baseUrl).toBe("http://127.0.0.1:9000/v1");
    expect(shared.tts.baseUrl).toBe("http://127.0.0.1:9000/v1");

    const own = loadVoiceAgentConfig({ ...AGENT, LOCAL_LLM_BASE_URL: "http://127.0.0.1:9000/v1", VOICE_BASE_URL: "http://gpu-box:8080/v1" });
    expect(own.llm.baseUrl).toBe("http://gpu-box:8080/v1");
  });

  it("takes the whisper.cpp program and model the Transcriber uses", () => {
    const config = loadVoiceAgentConfig({ ...AGENT, WHISPER_CLI_PATH: "/opt/whisper-cli", WHISPER_MODEL_PATH: "/models/base.en.bin" });
    expect(config.stt).toEqual({ whisperPath: "/opt/whisper-cli", modelPath: "/models/base.en.bin" });
  });

  it("sends the configured reasoning effort, or none at all with omit", () => {
    expect(loadVoiceAgentConfig({ ...AGENT, VOICE_LLM_REASONING_EFFORT: "low" }).llm.reasoningEffort).toBe("low");
    expect(loadVoiceAgentConfig({ ...AGENT, VOICE_LLM_REASONING_EFFORT: "omit" }).llm).not.toHaveProperty("reasoningEffort");
    expect(() => loadVoiceAgentConfig({ ...AGENT, VOICE_LLM_REASONING_EFFORT: "lots" })).toThrow(/VOICE_LLM_REASONING_EFFORT/);
  });

  it("takes the TTS voice and sample rate", () => {
    const config = loadVoiceAgentConfig({ ...AGENT, VOICE_TTS_VOICE: "alloy", VOICE_TTS_SAMPLE_RATE: "24000" });
    expect(config.tts).toMatchObject({ voice: "alloy", sampleRate: 24000 });
    for (const rate of ["22.05", "100", "fast"]) {
      expect(() => loadVoiceAgentConfig({ ...AGENT, VOICE_TTS_SAMPLE_RATE: rate })).toThrow(/VOICE_TTS_SAMPLE_RATE/);
    }
  });

  it("needs LiveKit and both models", () => {
    expect(() => loadVoiceAgentConfig({ VOICE_LLM_MODEL: "m", VOICE_TTS_MODEL: "t" })).toThrow(/needs LIVEKIT_URL/);
    expect(() => loadVoiceAgentConfig(LIVEKIT)).toThrow(
      new ConfigError("The voice agent also needs: VOICE_LLM_MODEL, VOICE_TTS_MODEL"),
    );
  });

  it("refuses a model server URL that isn't http(s)", () => {
    expect(() => loadVoiceAgentConfig({ ...AGENT, VOICE_BASE_URL: "localhost:8080" })).toThrow(/VOICE_BASE_URL/);
  });
});
