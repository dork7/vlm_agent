# 15: Voice Assistant on LiveKit with local models

**What to build:** A dashboard **Voice** page where a logged-in User talks out loud with a Voice Assistant through LiveKit, using only models on this machine: whisper.cpp to hear, a local OpenAI-compatible server (LocalAI) to answer and speak. A free conversation, not a Channel (ADR 0006).

**Blocked by:** 08

**Status:** ready-for-human

- [x] With `LIVEKIT_URL`, `LIVEKIT_API_KEY` and `LIVEKIT_API_SECRET` set, the dashboard has a Voice page linked from the nav; with none set it has none; with only some set, startup names what is missing.
- [x] `POST /voice/token` gives the logged-in User a short-lived token for a new room of their own, which dispatches the `voice-assistant` agent; not logged in is 401.
- [x] The page connects, turns on the microphone, plays the assistant, shows its state (listening, thinking, speaking) and the conversation as it is transcribed, and can mute and end.
- [x] The User can also type a question during the call (sent on LiveKit's `lk.chat` topic); the assistant stops talking and answers it the same way.
- [x] The assistant's answer streams onto the page word by word as it speaks (first words about 1 s after the question).
- [x] `npm run voice-agent` runs the agent worker: Silero VAD cuts turns, whisper.cpp transcribes them, the local LLM replies, and the local TTS speaks; it greets the User by name.
- [x] Checked end to end against a real `livekit-server --dev`, LocalAI (`gemma-4-e2b-it`, `vits-ljs-sherpa`) and whisper.cpp `small.en`, with a scripted participant speaking into the room.
- [ ] Checked by hand in a browser with a real microphone.

## Comments

- Config: `src/voice/config.ts`. The agent also needs `VOICE_LLM_MODEL` and `VOICE_TTS_MODEL`; `VOICE_BASE_URL` defaults to `LOCAL_LLM_BASE_URL`; `VOICE_TTS_SAMPLE_RATE` defaults to 22050 (what `vits-ljs-sherpa` speaks at; the agent names the right value if it differs); `VOICE_LLM_REASONING_EFFORT` defaults to `none`.
- STT: LocalAI has no working speech-to-text model here (`lfm3-audio` fails to load: unknown architecture `lfm3`), so the agent uses whisper.cpp through `WhisperStt` (`src/voice/whisper-stt.ts`), sharing `transcribeWav` with the Transcriber. It resamples the turn to 16 kHz mono.
- TTS: LocalAI answers `/audio/speech` with WAV even when asked for `pcm`, so the OpenAI plugin's TTS would play the header as a click. `LocalTts` (`src/voice/local-tts.ts`) asks for WAV and decodes it (`src/voice/wav.ts`).
- LLM: about half of `gemma-4-e2b-it`'s streamed replies came back with empty content, the answer filed under `reasoning`. Sending `reasoning_effort: none` fixed it (6 of 6 turns answered, and faster).
- Turn handling is all local: `turnDetection: "vad"`, `interruption.mode: "vad"`, no preemptive generation, so nothing calls LiveKit's hosted models.
- Known: on silence whisper.cpp can hear "you"; the VAD keeps silence from reaching it. The `vits-ljs-sherpa` voice says some words (e.g. "octopuses") so that whisper doesn't recognise them, which only matters for the scripted check.
- Tests: `test/voice-config.test.ts`, `test/dashboard-voice.test.ts`, `test/voice-audio.test.ts` (WAV and `LocalTts` against a fake server), `test/whisper-stt.slow.test.ts` (`npm run test:slow` now runs every slow test).
