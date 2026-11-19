/**
 * The voice agent: a LiveKit Agents worker that joins each Voice page room and talks with the User,
 * hearing them with whisper.cpp and thinking and speaking with models on a local OpenAI-compatible
 * server. Runs as its own process: `npm run voice-agent`.
 */
import { fileURLToPath } from "node:url";
import { cli, defineAgent, ServerOptions, voice, type JobContext, type JobProcess, type VAD } from "@livekit/agents";
import * as openai from "@livekit/agents-plugin-openai";
import * as silero from "@livekit/agents-plugin-silero";
import { ConfigError } from "../config.ts";
import { loadVoiceAgentConfig, VOICE_AGENT_NAME } from "./config.ts";
import { LocalTts } from "./local-tts.ts";
import { WhisperStt } from "./whisper-stt.ts";

/** What the assistant is told; replies are spoken, so they stay short and plain. */
export function assistantInstructions(username: string): string {
  return [
    `You are a friendly, helpful voice assistant talking with ${username}.`,
    "Your replies are read aloud, so answer in one to three short spoken sentences.",
    "Never use Markdown, lists, emoji, code or URLs. Say numbers and symbols the way a person would.",
    "If you did not catch what was said, ask the person to say it again.",
  ].join(" ");
}

type ProcessData = { vad: VAD };

export default defineAgent<ProcessData>({
  // Loaded once per worker process, before any room, so a new conversation starts without a wait.
  prewarm: async (proc: JobProcess<ProcessData>) => {
    proc.userData.vad = await silero.VAD.load();
  },

  entry: async (ctx: JobContext<ProcessData>) => {
    const config = loadVoiceAgentConfig(process.env);
    await ctx.connect();
    const participant = await ctx.waitForParticipant();
    const username = participant.name || "there";

    const session = new voice.AgentSession({
      vad: ctx.proc.userData.vad,
      stt: new WhisperStt(config.stt),
      llm: new openai.LLM({
        baseURL: config.llm.baseUrl,
        model: config.llm.model,
        apiKey: "local",
        ...(config.llm.reasoningEffort ? { reasoningEffort: config.llm.reasoningEffort } : {}),
      }),
      tts: new LocalTts(config.tts),
      // Everything runs locally: VAD ends the User's turn, and nothing calls LiveKit's hosted models.
      turnHandling: {
        turnDetection: "vad",
        interruption: { mode: "vad" },
        preemptiveGeneration: { enabled: false },
      },
    });

    await session.start({ agent: new voice.Agent({ instructions: assistantInstructions(username) }), room: ctx.room });
    // A fixed greeting, so the User hears the agent is there without waiting on the model.
    session.say(`Hi ${username}, I'm listening.`);
  },
});

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  let config;
  try {
    // Fail before registering with LiveKit, so a misconfigured agent never accepts a room it can't serve.
    config = loadVoiceAgentConfig(process.env);
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error;
    console.error(error.message);
    process.exit(1);
  }
  cli.runApp(
    new ServerOptions({
      agent: fileURLToPath(import.meta.url),
      agentName: VOICE_AGENT_NAME,
      wsURL: config.livekit.url,
      apiKey: config.livekit.apiKey,
      apiSecret: config.livekit.apiSecret,
    }),
  );
}
