# vlm_agent

Voice Notes Bot: turns Voice Messages and typed messages sent to a bot into Notes, Tasks and Inventory answers. See `.scratch/voice-notes-bot/spec.md`, `GLOSSARY.md` and `docs/adr/`.

## Running it

Requires Node.js 24.7+, and for Voice Messages ffmpeg, whisper.cpp and an English whisper model:

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

Startup fails with a message naming any missing required environment variable. With no Users in the database, it creates the first admin from `ADMIN_USERNAME`, `ADMIN_PASSWORD` and `ADMIN_TELEGRAM_ID` (your numeric Telegram user ID). The username and password default to `admin` / `changeme` when unset; startup prints a warning while the default password is in use, so set your own before the app is reachable by anyone else.

The dashboard at http://127.0.0.1:3000/tasks opens without a login as the first admin (oldest User if there is no admin). Anyone who can reach the dashboard can use that User's pages and actions. Explicit HTTP Basic credentials still select another User; invalid credentials return an error without a browser login prompt.

## Voice page (optional)

A User can talk with a voice assistant on the dashboard's **Voice** page. It runs on LiveKit and models on this machine: whisper.cpp hears, and an OpenAI-compatible server such as LocalAI thinks (`VOICE_LLM_MODEL`) and speaks (`VOICE_TTS_MODEL`). What is said there is not saved as Notes or Tasks (ADR 0006).

```sh
brew install livekit
livekit-server --dev      # local LiveKit server on ws://localhost:7880 (key "devkey", secret "secret")
npm run voice-agent       # the voice agent, in its own terminal (voice-agent:dev for verbose logs)
npm start                 # the app; set the LIVEKIT_ and VOICE_ variables in .env first
```

Then open http://127.0.0.1:3000/voice and press **Start talking**. Browsers allow the microphone only on `localhost`/`127.0.0.1` or over HTTPS; to reach the page from another machine, serve both the app and LiveKit (`wss://`) over HTTPS.

## Agent Bots: real estate on Telegram (optional)

Agent Bots answer customers on Telegram from a Dataset you import, following a Markdown Conversation Guide. They are managed in the web console at `/agents` (same login as the dashboard).

1. Create a bot with [@BotFather](https://t.me/BotFather) and copy its token. Start the app (`npm start`). On a fresh database a **Sample Real Estate Bot** and a **Sample listings** Dataset (from `dataset/sample-listings.csv`, images in `dataset/images/`) are created for you (only when there are no bots yet; set `AGENT_SAMPLE_BOT_TOKEN` to pre-fill the token).
2. Open `http://localhost:<PORT>/agents`, open the sample bot, paste your token, and **Save**, then **Start**. A bad token shows an error and does not stop the app.
3. Try it without Telegram in the **Test chat** box on the bot page ("2 bed near marina"), or message the bot on Telegram.
4. To take bookings, click **New link code** on the bot page and send `/link CODE` to the bot from the Property Agent's Telegram account. Until a Property Agent is linked, the bot tells customers booking is unavailable. Once linked, customers can ask for a viewing; the Property Agent gets Confirm/Decline buttons, then is asked for a location pin, which the bot relays to the customer.
5. Your own data: **New Dataset**, upload a CSV or JSON file (or drop it in `dataset/`), map the location, unit type, price, images and payment fields, and check the missing-images report. Edit the bot's Conversation Guide in the console; changes apply to the next message.

Set `DATASET_DIR` to use another folder. Chat logs and Appointments are on each bot's page.
