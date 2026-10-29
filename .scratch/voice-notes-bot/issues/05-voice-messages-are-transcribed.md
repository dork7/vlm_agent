# 05: Voice Messages are transcribed

**What to build:** A User sends a spoken Voice Message on Telegram and it is handled exactly like typed text. The Telegram adapter passes the audio (a way to fetch it, plus its duration) to the core; the Transcriber converts it to 16 kHz mono WAV with ffmpeg and transcribes it with the whisper.cpp command-line program using an English-only model chosen by configuration (default small.en). Voice Messages over 5 minutes are refused with a request to split them, before anything is downloaded. Audio files are deleted after transcription whether it succeeded or failed.

**Blocked by:** 01

**Status:** ready-for-agent

- [x] Through Seam 1 with a fake Transcriber, an audio inbound message produces the same Note/Task outcome as the equivalent typed text.
- [x] A Voice Message over 5 minutes produces a "please split it" reply without fetching or transcribing the audio.
- [x] Temporary audio files are removed after both successful and failed transcriptions.
- [x] A transcription failure produces an error event and saves nothing.
- [x] Transcription duration and Transcript length are captured for ticket 12.
- [x] An optional slow test runs the real Transcriber on a short sample audio file and is skipped when ffmpeg, whisper.cpp or the model is missing.

## Comments

- The core's inbound content is now text or audio (`durationSeconds` plus `download(toPath)`). Over 300 seconds gets a `voice-too-long` result before the audio is downloaded; exactly 300 is transcribed. Unknown senders are refused before anything is downloaded.
- `src/transcriber/transcriber.ts`: makes a temporary folder per Voice Message, downloads into it, converts with ffmpeg to 16 kHz mono WAV, runs `whisper-cli -l en` with the configured model, and removes the folder in a `finally`. whisper's silence markers such as `[BLANK_AUDIO]` are dropped; a Transcript that is then empty counts as a failure.
- Config: `WHISPER_MODEL_PATH` (default `./models/ggml-small.en.bin`, gitignored), `FFMPEG_PATH`, `WHISPER_CLI_PATH`. Startup fails with a clear message when the model file is missing.
- `HandledMessage.transcription` holds the model, the transcription's duration and the Transcript's length, or the error when it failed, for ticket 12. Download, conversion and transcription are timed together; ticket 12 will need them split into stages.
- Telegram: `message:voice` is handled; the audio comes from `getFile` and Telegram's file URL.
- A failed download's clean-up is tested in the default suite (`test/transcriber.test.ts`). `test/transcriber.slow.test.ts` runs with `npm run test:slow` (not in `npm test`), on `test/fixtures/sample-voice.ogg` (made with macOS `say`, Opus like Telegram). It passed here with small.en. Sending a real Voice Message from Telegram is still to be checked by hand.

