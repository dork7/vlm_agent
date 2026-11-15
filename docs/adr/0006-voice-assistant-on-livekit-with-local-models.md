# Voice Assistant on self-hosted LiveKit with local models, outside the core

The Voice page gives a User a live spoken conversation with an AI assistant. It runs on a self-hosted LiveKit server, and a LiveKit Agents worker (`src/voice/agent.ts`, its own process) joins each conversation's room. Every model is local: whisper.cpp (the same program and model as the Transcriber) hears each turn, and an OpenAI-compatible server on this machine (LocalAI) answers and speaks. Nothing is sent to a hosted AI service.

It is deliberately not a Channel (ADR 0005): the assistant is free conversation and does not pass through the core, so nothing said there becomes a Note, Task or Query, and it records no Runs. Making it a Channel later means adding tools that call the core, not changing the core.

The dashboard only mints the LiveKit token: one new room per conversation, joinable by the logged-in User alone, which dispatches the agent by name (`voice-assistant`). The browser talks to LiveKit directly, with the LiveKit client served by this app rather than a CDN.

Local thinking models are asked for `reasoning_effort: none`: a spoken reply can't wait for thinking, and Gemma 4 on LocalAI otherwise often puts its whole answer in its reasoning, leaving nothing to say.
