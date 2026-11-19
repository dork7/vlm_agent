import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

/**
 * Text-to-speech using a local command.
 *
 * The command is invoked as: `command ...args {input} {output}` where `{input}` is a text file
 * and `{output}` is the audio file it should write. The raw output is then converted to 16 kHz
 * mono WAV with ffmpeg so browsers can play it.
 *
 * Defaults suit macOS (`say` is built-in). On other systems, configure `TTS_COMMAND`/`TTS_ARGS`
 * for a local TTS tool such as `espeak-ng` or `piper`.
 */
export type Tts = {
  /** Synthesizes `text` to WAV audio; returns the WAV bytes. */
  speak(text: string): Promise<Buffer>;
};

export function createTts(config: {
  command: string;
  /** `{input}` and `{output}` are replaced with temp file paths. */
  args: string[];
  ffmpegPath: string;
}): Tts {
  return {
    async speak(text) {
      const dir = await mkdtemp(join(tmpdir(), "voice-tts-"));
      try {
        const input = join(dir, "input.txt");
        const raw = join(dir, "output.raw");
        const wav = join(dir, "output.wav");
        await writeFile(input, text, "utf8");
        const args = config.args.map((a) => a.replace("{input}", input).replace("{output}", raw));
        await run(config.command, args, { timeout: 60_000 });
        // Convert whatever the TTS tool produced into browser-playable WAV.
        await run(
          config.ffmpegPath,
          ["-nostdin", "-loglevel", "error", "-y", "-i", raw, "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", wav],
          { timeout: 30_000 },
        );
        return await readFile(wav);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
  };
}
