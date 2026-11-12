# vlm_agent

Voice Notes Bot: turns Voice Messages and typed messages sent to a bot into Notes, Tasks and Inventory answers. See `.scratch/voice-notes-bot/spec.md`, `GLOSSARY.md` and `docs/adr/`.

## Running it

Requires Node.js 22+, and for Voice Messages ffmpeg, whisper.cpp and an English whisper model:

```sh
brew install ffmpeg whisper-cpp
mkdir -p models && curl -L -o models/ggml-small.en.bin \
  https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.en.bin
```

```sh
npm install          # install
npm run typecheck    # typecheck
npm test             # test suite (downloads a MongoDB binary on first run)
npm run test:slow    # the real Transcriber on a sample; skips what isn't installed
cp .env.example .env # then fill it in
npm start            # start the app (Telegram long polling + Fastify)
```

Startup fails with a message naming any missing required environment variable. With no Users in the database, it creates the first admin from `ADMIN_USERNAME`, `ADMIN_PASSWORD` and `ADMIN_TELEGRAM_ID` (your numeric Telegram user ID).

## Voice page (optional)

A logged-in User can talk with a voice assistant on the dashboard's **Voice** page. It runs on LiveKit and models on this machine: whisper.cpp hears, and an OpenAI-compatible server such as LocalAI thinks (`VOICE_LLM_MODEL`) and speaks (`VOICE_TTS_MODEL`). What is said there is not saved as Notes or Tasks (ADR 0006).

```sh
brew install livekit
livekit-server --dev      # local LiveKit server on ws://localhost:7880 (key "devkey", secret "secret")
npm run voice-agent       # the voice agent, in its own terminal (voice-agent:dev for verbose logs)
npm start                 # the app; set the LIVEKIT_ and VOICE_ variables in .env first
```

Then open http://127.0.0.1:3000/voice and press **Start talking**. Browsers allow the microphone only on `localhost`/`127.0.0.1` or over HTTPS; to reach the page from another machine, serve both the app and LiveKit (`wss://`) over HTTPS.
