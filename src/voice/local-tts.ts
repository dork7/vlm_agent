import { AudioByteStream, shortuuid, tts, type APIConnectOptions } from "@livekit/agents";
import { decodeWav } from "./wav.ts";

export type LocalTtsConfig = {
  /** An OpenAI-compatible server, such as LocalAI, e.g. http://localhost:8080/v1. */
  baseUrl: string;
  model: string;
  /** The model's voice; "" for its default. */
  voice: string;
  /** The rate the model speaks at; the server's WAV must match it. */
  sampleRate: number;
};

/**
 * Text-to-speech from a local OpenAI-compatible server's /audio/speech. Asks for WAV and reads its
 * header, since local servers such as LocalAI answer with WAV even when asked for raw PCM.
 */
export class LocalTts extends tts.TTS {
  label = "local.TTS";
  readonly #config: LocalTtsConfig;

  constructor(config: LocalTtsConfig) {
    super(config.sampleRate, 1, { streaming: false });
    this.#config = config;
  }

  override get model(): string {
    return this.#config.model;
  }

  override get provider(): string {
    return "local";
  }

  synthesize(text: string, connOptions?: APIConnectOptions, abortSignal?: AbortSignal): tts.ChunkedStream {
    return new LocalChunkedStream(this, text, this.#config, connOptions, abortSignal);
  }

  stream(): tts.SynthesizeStream {
    throw new Error("The local TTS speaks whole sentences; the agent splits text into sentences for it");
  }
}

class LocalChunkedStream extends tts.ChunkedStream {
  label = "local.ChunkedStream";
  readonly #config: LocalTtsConfig;

  constructor(owner: LocalTts, text: string, config: LocalTtsConfig, connOptions?: APIConnectOptions, abortSignal?: AbortSignal) {
    super(text, owner, connOptions, abortSignal);
    this.#config = config;
  }

  protected async run(): Promise<void> {
    try {
      const response = await fetch(`${this.#config.baseUrl}/audio/speech`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: this.#config.model,
          input: this.inputText,
          ...(this.#config.voice ? { voice: this.#config.voice } : {}),
          response_format: "wav",
        }),
        signal: this.abortSignal,
      });
      if (!response.ok) {
        throw new Error(`Text-to-speech failed with HTTP ${response.status}: ${(await response.text()).slice(0, 200)}`);
      }
      const audio = decodeWav(new Uint8Array(await response.arrayBuffer()));
      if (audio.sampleRate !== this.#config.sampleRate || audio.channels !== 1) {
        throw new Error(
          `${this.#config.model} speaks ${audio.channels}-channel audio at ${audio.sampleRate} Hz; ` +
            `set VOICE_TTS_SAMPLE_RATE=${audio.sampleRate} (and use a mono voice)`,
        );
      }

      const requestId = shortuuid();
      const bytes = new AudioByteStream(audio.sampleRate, 1);
      const pcm = audio.samples.buffer.slice(audio.samples.byteOffset, audio.samples.byteOffset + audio.samples.byteLength);
      const frames = [...bytes.write(pcm as ArrayBuffer), ...bytes.flush()];
      frames.forEach((frame, index) => {
        this.queue.put({ requestId, segmentId: requestId, frame, final: index === frames.length - 1 });
      });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") return;
      throw error;
    } finally {
      this.queue.close();
    }
  }
}
