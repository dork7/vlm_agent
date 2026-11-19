import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { initializeLogger } from "@livekit/agents";
import { LocalTts } from "../src/voice/local-tts.ts";
import { decodeWav, encodeWav } from "../src/voice/wav.ts";

initializeLogger({ pretty: false, level: "silent" });

const tone = (count: number) => Int16Array.from({ length: count }, (_, i) => Math.round(Math.sin(i / 8) * 10_000));

describe("WAV files", () => {
  it("round-trips 16-bit PCM", () => {
    const samples = tone(1000);
    const decoded = decodeWav(encodeWav({ sampleRate: 16_000, channels: 1, samples }));

    expect(decoded.sampleRate).toBe(16_000);
    expect(decoded.channels).toBe(1);
    expect([...decoded.samples]).toEqual([...samples]);
  });

  it("skips chunks other than the format and the audio", () => {
    const wav = encodeWav({ sampleRate: 22_050, channels: 1, samples: tone(10) });
    // A LIST chunk (odd-sized, so padded) between "fmt " and "data", as some encoders write.
    const list = Buffer.concat([Buffer.from("LIST"), Buffer.from([3, 0, 0, 0]), Buffer.from("abc\0")]);
    const withList = Buffer.concat([wav.subarray(0, 36), list, wav.subarray(36)]);

    expect([...decodeWav(withList).samples]).toEqual([...tone(10)]);
  });

  it("reads what audio there is when the size is a streaming placeholder", () => {
    const wav = encodeWav({ sampleRate: 22_050, channels: 1, samples: tone(10) });
    wav.writeUInt32LE(0xffffffff, 40);

    expect(decodeWav(wav).samples).toHaveLength(10);
  });

  it("refuses anything but 16-bit PCM WAV", () => {
    expect(() => decodeWav(Buffer.from("ID3 this is an mp3"))).toThrow("Not a WAV file");
    const float = encodeWav({ sampleRate: 16_000, channels: 1, samples: tone(4) });
    float.writeUInt16LE(3, 20); // IEEE float
    expect(() => decodeWav(float)).toThrow(/Only 16-bit PCM WAV/);
  });
});

describe("the local text-to-speech", () => {
  let server: Server | undefined;
  afterEach(() => new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve())));

  /** A fake OpenAI-compatible /audio/speech that answers with WAV, as LocalAI does; records each request. */
  async function speechServer(answer: Buffer) {
    const requests: unknown[] = [];
    server = createServer(async (request, response) => {
      let body = "";
      for await (const chunk of request) body += chunk;
      requests.push({ url: request.url, body: JSON.parse(body) });
      response.writeHead(200, { "content-type": "audio/wav" }).end(answer);
    });
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
    return { baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`, requests };
  }

  it("asks the model server for WAV and plays every sample, without the header", async () => {
    const samples = tone(22_050); // one second
    const { baseUrl, requests } = await speechServer(encodeWav({ sampleRate: 22_050, channels: 1, samples }));
    const tts = new LocalTts({ baseUrl, model: "vits-ljs-sherpa", voice: "", sampleRate: 22_050 });

    const frames = [];
    for await (const audio of tts.synthesize("Hello there.")) frames.push(audio);

    expect(requests).toEqual([
      { url: "/v1/audio/speech", body: { model: "vits-ljs-sherpa", input: "Hello there.", response_format: "wav" } },
    ]);
    const played = frames.flatMap((audio) => [...audio.frame.data]);
    expect(played).toEqual([...samples]);
    expect(frames.every((audio) => audio.frame.sampleRate === 22_050)).toBe(true);
    expect(frames.at(-1)?.final).toBe(true);
  });

  it("sends the voice when one is configured", async () => {
    const { baseUrl, requests } = await speechServer(encodeWav({ sampleRate: 24_000, channels: 1, samples: tone(2400) }));
    const tts = new LocalTts({ baseUrl, model: "tts-1", voice: "alloy", sampleRate: 24_000 });

    for await (const _ of tts.synthesize("Hi.")) {
      // drain
    }

    expect(requests).toEqual([{ url: "/v1/audio/speech", body: expect.objectContaining({ voice: "alloy" }) }]);
  });

  it("plays nothing when the server speaks at another rate than configured", async () => {
    const { baseUrl } = await speechServer(encodeWav({ sampleRate: 16_000, channels: 1, samples: tone(1600) }));
    const tts = new LocalTts({ baseUrl, model: "vits-ljs-sherpa", voice: "", sampleRate: 22_050 });
    const errors: Error[] = [];
    tts.on("error", (event) => errors.push(event.error));

    const frames = [];
    const stream = tts.synthesize("Hello.", { maxRetry: 0, retryIntervalMs: 0, timeoutMs: 5000 });
    for await (const audio of stream) frames.push(audio);

    expect(frames).toEqual([]);
    expect(errors.map((error) => error.message).join("\n")).toContain("set VOICE_TTS_SAMPLE_RATE=16000");
  });
});
