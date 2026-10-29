import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { promisify } from "node:util";

/** A Voice Message's audio, as a Channel offers it: a way to fetch it, and how long it is. */
export type AudioSource = {
  durationSeconds: number;
  /** Saves the audio, in whatever format the Channel uses, to this file. */
  download(toPath: string): Promise<void>;
};

export type Transcriber = {
  /** The speech-to-text model used, for the Run record. */
  readonly model: string;
  /** Returns the Transcript; throws when transcription fails or hears nothing. */
  transcribe(audio: AudioSource): Promise<string>;
};

const run = promisify(execFile);
const CONVERT_TIMEOUT_MS = 60_000;
const TRANSCRIBE_TIMEOUT_MS = 10 * 60_000;

/**
 * Converts the audio to 16 kHz mono WAV with ffmpeg and transcribes it with the whisper.cpp
 * command-line program. Every audio file is deleted afterwards, whether it worked or not.
 */
export function createWhisperTranscriber(config: {
  ffmpegPath: string;
  whisperPath: string;
  modelPath: string;
  /** Where each transcription's temporary folder is made; defaults to the system's temp folder. */
  workDir?: string;
}): Transcriber {
  return {
    model: basename(config.modelPath),
    async transcribe(audio) {
      const dir = await mkdtemp(join(config.workDir ?? tmpdir(), "voice-"));
      try {
        const original = join(dir, "original");
        const wav = join(dir, "audio.wav");
        const output = join(dir, "transcript");
        await audio.download(original);
        await run(
          config.ffmpegPath,
          ["-nostdin", "-loglevel", "error", "-y", "-i", original, "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", wav],
          { timeout: CONVERT_TIMEOUT_MS },
        );
        await run(
          config.whisperPath,
          ["-m", config.modelPath, "-f", wav, "-l", "en", "-nt", "-np", "-otxt", "-of", output],
          { timeout: TRANSCRIBE_TIMEOUT_MS },
        );
        const transcript = cleanTranscript(await readFile(`${output}.txt`, "utf8"));
        if (transcript === "") throw new Error("Transcription heard no speech");
        return transcript;
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
  };
}

/** Joins whisper's lines and drops its markers for silence or noise, such as [BLANK_AUDIO]. */
function cleanTranscript(raw: string): string {
  return raw
    .replace(/\[(?:BLANK_AUDIO|SILENCE|MUSIC|NOISE|INAUDIBLE)\]|\((?:silence|music|noise|inaudible)\)/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}
