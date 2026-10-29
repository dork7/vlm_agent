import { execFileSync } from "node:child_process";
import { copyFile, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createWhisperTranscriber, type AudioSource } from "../src/transcriber/transcriber.ts";

const FFMPEG = process.env.FFMPEG_PATH ?? "ffmpeg";
const WHISPER = process.env.WHISPER_CLI_PATH ?? "whisper-cli";
const MODEL = process.env.WHISPER_MODEL_PATH ?? "./models/ggml-small.en.bin";
const SAMPLE = new URL("./fixtures/sample-voice.ogg", import.meta.url).pathname;

const installed = (program: string) => {
  try {
    execFileSync(program, ["-h"], { stdio: "ignore" });
    return true;
  } catch (error) {
    // Both programs print their help and may exit non-zero; only a missing program is "not installed".
    return (error as NodeJS.ErrnoException).code !== "ENOENT";
  }
};
const hasFfmpeg = installed(FFMPEG);
const hasWhisper = hasFfmpeg && installed(WHISPER) && existsSync(MODEL);

describe("the real Transcriber (ffmpeg + whisper.cpp)", () => {
  let workDir: string;
  beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), "transcriber-test-"));
  });
  afterEach(() => rm(workDir, { recursive: true, force: true }));

  const transcriber = () =>
    createWhisperTranscriber({ ffmpegPath: FFMPEG, whisperPath: WHISPER, modelPath: MODEL, workDir });
  const audio = (download: (toPath: string) => Promise<void>): AudioSource => ({ durationSeconds: 3, download });

  it.skipIf(!hasWhisper)("transcribes a short English Voice Message and deletes the audio", async () => {
    const transcript = await transcriber().transcribe(audio((toPath) => copyFile(SAMPLE, toPath)));

    expect(transcript.toLowerCase()).toContain("oat milk");
    expect(await readdir(workDir)).toEqual([]);
  }, 120_000);

  it.skipIf(!hasFfmpeg)("deletes the audio when the audio cannot be converted", async () => {
    await expect(
      transcriber().transcribe(audio((toPath) => writeFile(toPath, "this is not audio"))),
    ).rejects.toThrow();

    expect(await readdir(workDir)).toEqual([]);
  });
});
