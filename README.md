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
