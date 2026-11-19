import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AudioFrame } from "@livekit/rtc-node";
import { decodeWav } from "../src/voice/wav.ts";
import { WhisperStt } from "../src/voice/whisper-stt.ts";

const FFMPEG = process.env.FFMPEG_PATH ?? "ffmpeg";
const WHISPER = process.env.WHISPER_CLI_PATH ?? "whisper-cli";
const MODEL = process.env.WHISPER_MODEL_PATH ?? "./models/ggml-small.en.bin";
const SAMPLE = new URL("./fixtures/sample-voice.ogg", import.meta.url).pathname;

const installed = (program: string) => {
  try {
    execFileSync(program, ["-h"], { stdio: "ignore" });
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ENOENT";
  }
};
const hasWhisper = installed(FFMPEG) && installed(WHISPER) && existsSync(MODEL);

describe("the voice agent's speech-to-text (whisper.cpp)", () => {
  let workDir: string;
  beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), "whisper-stt-test-"));
  });
  afterEach(() => rm(workDir, { recursive: true, force: true }));

  /** The sample Voice Message as the 48 kHz stereo frames a browser's microphone track gives the agent. */
  async function browserFrames(): Promise<AudioFrame[]> {
    const wav = join(workDir, "..", `sample-${process.pid}.wav`);
    execFileSync(FFMPEG, ["-nostdin", "-loglevel", "error", "-y", "-i", SAMPLE, "-ar", "48000", "-ac", "2", "-c:a", "pcm_s16le", wav]);
    const { samples } = decodeWav(await readFile(wav));
    await rm(wav);
    const perFrame = 480 * 2; // 10 ms of stereo
    const frames = [];
    for (let i = 0; i + perFrame <= samples.length; i += perFrame) {
      frames.push(new AudioFrame(samples.slice(i, i + perFrame), 48_000, 2, 480));
    }
    return frames;
  }

  it.skipIf(!hasWhisper)("hears a spoken turn and deletes its audio", async () => {
    const stt = new WhisperStt({ whisperPath: WHISPER, modelPath: MODEL, workDir });

    const event = await stt.recognize(await browserFrames());

    expect(event.alternatives?.[0].text.toLowerCase()).toContain("oat milk");
    expect(await readdir(workDir)).toEqual([]);
  }, 120_000);
});
