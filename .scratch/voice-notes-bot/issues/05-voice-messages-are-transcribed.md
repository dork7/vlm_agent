# 05: Voice Messages are transcribed

**What to build:** A User sends a spoken Voice Message on Telegram and it is handled exactly like typed text. The Telegram adapter passes the audio (a way to fetch it, plus its duration) to the core; the Transcriber converts it to 16 kHz mono WAV with ffmpeg and transcribes it with the whisper.cpp command-line program using an English-only model chosen by configuration (default small.en). Voice Messages over 5 minutes are refused with a request to split them, before anything is downloaded. Audio files are deleted after transcription whether it succeeded or failed.

**Blocked by:** 01

**Status:** ready-for-agent

- [ ] Through Seam 1 with a fake Transcriber, an audio inbound message produces the same Note/Task outcome as the equivalent typed text.
- [ ] A Voice Message over 5 minutes produces a "please split it" reply without fetching or transcribing the audio.
- [ ] Temporary audio files are removed after both successful and failed transcriptions.
- [ ] A transcription failure produces an error event and saves nothing.
- [ ] Transcription duration and Transcript length are captured for ticket 12.
- [ ] An optional slow test runs the real Transcriber on a short sample audio file and is skipped when ffmpeg, whisper.cpp or the model is missing.
