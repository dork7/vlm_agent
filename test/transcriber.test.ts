import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createWhisperTranscriber } from "../src/transcriber/transcriber.ts";

// Runs in the default suite: it fails before ffmpeg or whisper.cpp would be needed.
describe("the Transcriber", () => {
  let workDir: string;
  beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), "transcriber-test-"));
  });
  afterEach(() => rm(workDir, { recursive: true, force: true }));

  it("deletes the audio when the download fails part-way", async () => {
    const transcriber = createWhisperTranscriber({
      ffmpegPath: "ffmpeg",
      whisperPath: "whisper-cli",
      modelPath: "/models/ggml-small.en.bin",
      workDir,
    });

    await expect(
      transcriber.transcribe({
        durationSeconds: 3,
        download: async (toPath) => {
          await writeFile(toPath, "partial");
          throw new Error("connection reset");
        },
      }),
    ).rejects.toThrow("connection reset");

    expect(await readdir(workDir)).toEqual([]);
    expect(transcriber.model).toBe("ggml-small.en.bin");
  });
});
