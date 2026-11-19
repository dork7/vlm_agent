import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { mergeFrames, stt, type AudioBuffer } from "@livekit/agents";
import { AudioFrame, AudioResampler } from "@livekit/rtc-node";
import { transcribeWav } from "../transcriber/transcriber.ts";
import { encodeWav } from "./wav.ts";

/** whisper.cpp reads 16 kHz audio. */
const WHISPER_SAMPLE_RATE = 16_000;
/** One spoken turn is short; a stuck whisper-cli must not hold the conversation for minutes. */
const TURN_TIMEOUT_MS = 60_000;

/**
 * Speech-to-text with the local whisper.cpp program the Transcriber already uses. It hears whole
 * turns, not a live stream: the agent's VAD cuts the User's speech into turns and passes each one here.
 */
export class WhisperStt extends stt.STT {
  label = "whisper.cpp";
  readonly #config: { whisperPath: string; modelPath: string; workDir?: string };

  constructor(config: { whisperPath: string; modelPath: string; workDir?: string }) {
    super({ streaming: false, interimResults: false });
    this.#config = config;
  }

  override get model(): string {
    return basename(this.#config.modelPath);
  }

  override get provider(): string {
    return "whisper.cpp";
  }

  protected async _recognize(buffer: AudioBuffer): Promise<stt.SpeechEvent> {
    const audio = toMono16k(mergeFrames(buffer));
    const dir = await mkdtemp(join(this.#config.workDir ?? tmpdir(), "voice-turn-"));
    let text;
    try {
      const wav = join(dir, "turn.wav");
      await writeFile(wav, encodeWav({ sampleRate: WHISPER_SAMPLE_RATE, channels: 1, samples: audio }));
      text = await transcribeWav(this.#config, wav, join(dir, "turn"), TURN_TIMEOUT_MS);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
    return {
      type: stt.SpeechEventType.FINAL_TRANSCRIPT,
      alternatives: [{ text, language: "en" as stt.SpeechData["language"], startTime: 0, endTime: 0, confidence: 0 }],
    };
  }

  stream(): stt.SpeechStream {
    throw new Error("whisper.cpp hears whole turns; give the agent a VAD so it can cut speech into turns");
  }
}

/** The frame's samples as 16 kHz mono, resampling and mixing down as needed. */
function toMono16k(frame: AudioFrame): Int16Array {
  let mono = frame.data;
  if (frame.channels > 1) {
    mono = new Int16Array(frame.samplesPerChannel);
    for (let i = 0; i < frame.samplesPerChannel; i++) {
      let sum = 0;
      for (let c = 0; c < frame.channels; c++) sum += frame.data[i * frame.channels + c]!;
      mono[i] = Math.round(sum / frame.channels);
    }
  }
  if (frame.sampleRate === WHISPER_SAMPLE_RATE) return mono;

  const resampler = new AudioResampler(frame.sampleRate, WHISPER_SAMPLE_RATE, 1);
  const out = [...resampler.push(new AudioFrame(mono, frame.sampleRate, 1, mono.length)), ...resampler.flush()];
  return mergeFrames(out).data;
}

