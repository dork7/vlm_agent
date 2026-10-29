# Spec: Voice Notes Bot v1

Status: ready-for-agent

## Problem Statement

I think of things all day (ideas, to-dos, questions about stock) and typing them out is slow, so they get lost. I want to send a quick Voice Message from my phone and have it turned into something I can use: a Note I can find later, a Task I can tick off, or an immediate answer about my Inventory. I also want to see what the bot did with each message, and to be able to add a few other people without it being tied forever to one messaging app.

## Solution

A bot I talk to on Telegram (the first Channel). I send a Voice Message, or type a message; the bot transcribes it locally with free speech-to-text, uses an AI model to decide whether it is a Note, a Task or a Query, and then:

- saves a **Note** with an AI-written Heading,
- saves a **Task** with an AI-written Heading, Description and optional due date, and sends a **Reminder** when it falls due,
- answers a **Query** by looking up the Inventory through a small built-in Inventory API,
- or, when it can't tell, asks me a **Clarification** (buttons where the Channel supports them, a plain text question otherwise).

The bot replies on the same Channel with the result. A web dashboard, protected by a login, lets each User browse, edit and manage their own Notes and Tasks separately; admins can also see an observability dashboard of every Run and manage Users and their Channel Identities from a portal. The core knows nothing about Telegram, so WhatsApp and an MCP Channel can be added later as adapters. v1 runs on my machine only.

## User Stories

### Sending messages

1. As a User, I want to send a Voice Message to the bot on Telegram, so that I can capture a thought without typing.
2. As a User, I want to type a text message instead of speaking, so that I can use the bot where I can't talk out loud.
3. As a User, I want the bot to acknowledge my message straight away with a "processing" reply, so that I know it was received.
4. As a User, I want the processing reply to be updated with the result when the Channel supports editing, so that my chat isn't cluttered.
5. As a User, I want a new message with the result when the Channel can't edit messages, so that I still get an answer.
6. As a User, I want Voice Messages longer than 5 minutes to be refused with a request to split them, so that I'm not left waiting on a transcription that takes forever.
7. As a User, I want my audio deleted once it has been transcribed, so that recordings of my voice aren't kept on the server.
8. As a User, I want the same message delivered twice by the Channel to be handled only once, so that I don't get duplicate Notes or Tasks.
9. As a User, I want a clear error reply when something fails, so that I know to resend instead of waiting.

### Access

10. As the owner, I want only people who are Users with a matching Channel Identity to be able to use the bot, so that strangers can't use my server or read my Inventory.
11. As an unknown person, I want a polite refusal when I message the bot, so that I know I'm not allowed rather than being ignored.
12. As a User, I want my Notes and Tasks kept separate from other Users', so that nobody else sees my data.

### Transcription

13. As a User, I want my English Voice Messages transcribed accurately, so that my Notes and Tasks say what I meant.
14. As the owner, I want transcription to run locally with free software, so that I pay nothing per message.
15. As the owner, I want the speech model to be configurable, so that I can use a smaller one when deployed to a weaker server.

### Classification

16. As a User, I want the bot to work out by itself whether I meant a Note, a Task or a Query, so that I don't have to say which.
17. As a User, I want to be asked a Clarification when my message is unclear, so that it isn't filed wrongly.
18. As a User on Telegram, I want the Clarification shown as Note / Task / Query buttons, so that I can answer with one tap.
19. As a User on a Channel without buttons, I want the Clarification asked as a text question I can answer by replying, so that it works anywhere.
20. As a User, I want an unanswered Clarification to stay waiting without timing out, so that I can answer later.
21. As a User, I want a request to change Inventory data (a Command) to be politely declined, so that a misheard word never changes real data.

### Notes

22. As a User, I want a Note saved with a short AI-written Heading naming its most important point, so that I can scan my Notes quickly.
23. As a User, I want the full Transcript kept with each Note, so that nothing I said is lost.
24. As a User, I want the reply to tell me the Note's Heading, so that I can confirm it was understood.

### Tasks

25. As a User, I want a Task saved with a Heading naming the most important thing to do, so that my Task list is readable.
26. As a User, I want each Task to have an AI-written Description covering everything I mentioned, so that one message with several to-dos still keeps every detail.
27. As a User, I want a due date, and a time if I say one, captured when I mention it, so that I can see when things are due.
28. As a User, I want the original Transcript kept with each Task, so that I can check what I actually said.
29. As a User, I want the reply to tell me the Task's Heading and due date, so that I can confirm it was understood.
78. As a User, I want to ask the bot to show my Tasks ("show tasks", "what's on my list?") and get back all my saved Tasks, so that I can check them from the chat without opening the dashboard.

### Reminders

30. As a User, I want the bot to send me a Reminder on the Channel where I created a Task when that Task falls due, so that I don't forget it.
31. As a User, I want a Task with a due date but no time to be reminded at 9:00 on that day in my timezone, so that I'm not woken at midnight.
32. As a User, I want each User to have a timezone, so that due times mean my local time.
33. As a User, I want a Reminder sent only once, so that I'm not spammed.
34. As a User, I want no Reminder for a Task I've already marked done, so that I'm only reminded about open work.
35. As a User on Telegram, I want a "Done" button on the Reminder, so that I can close the Task straight from the chat.
36. As a User, I want Reminders that fell due while the bot was not running to be sent as soon as it starts again, so that none are silently lost.
37. As a User, I want changing a Task's due date to schedule a fresh Reminder, so that the Reminder follows the new date.

### Queries

38. As a User, I want to ask about stock levels by voice ("how many blue mugs do we have?"), so that I get an answer without opening another app.
39. As a User, I want to search the Inventory by name, category, location or low stock, so that I can ask natural questions.
40. As a User, I want to ask about a specific item by its SKU, so that I get its exact details.
41. As a User, I want the answer written in plain language, so that I can read it at a glance.
42. As a User, I want to be told clearly when nothing matches, so that I don't mistake silence for "zero in stock".

### AI models

43. As the owner, I want to define an ordered list of OpenRouter models, so that I can choose cheap or free models and change them without code changes.
44. As the owner, I want the bot to switch to the next model when one fails or returns an unusable answer, so that one provider's outage or rate limit doesn't stop the bot.
45. As the owner, I want a clear failure reply when every model in the list fails, so that the User knows to try again.

### Inventory API

46. As the owner, I want a built-in dummy Inventory API with realistic sample data, so that I can build and test Queries before connecting a real system.
47. As the owner, I want the Inventory API protected by an API key, so that it behaves like a real external system.
48. As the owner, I want the bot to reach the Inventory API over HTTP using a configured base URL and key, so that swapping in a real inventory system later is a configuration change.

### Notes and Tasks dashboard

49. As a User, I want to log in to the dashboard with a username and password, so that my data is private.
50. As a User, I want a Notes page listing my Notes newest first, so that I can review what I captured.
51. As a User, I want to search my Notes, so that I can find an old idea.
52. As a User, I want to open a Note and read its full Transcript, so that I can see exactly what I said.
53. As a User, I want to delete a Note, so that I can clear out things I no longer need.
54. As a User, I want to edit a Note's Heading and text, so that I can fix a misheard word or a poor Heading.
55. As a User, I want a separate Tasks page with Open and Done tabs, so that I can focus on what's left to do.
56. As a User, I want to mark a Task done and reopen it, so that my list reflects reality.
57. As a User, I want to see a Task's Description, due date and source Transcript, so that I have the full context.
58. As a User, I want to delete a Task, so that I can remove mistakes.
59. As a User, I want to edit a Task's Heading, Description and due date, so that it stays accurate as plans change.

### Observability dashboard

60. As an admin, I want a list of recent Runs with their outcome and total time, so that I can see at a glance whether the bot is healthy.
61. As an admin, I want to open a Run and see each stage (received, download, conversion, transcription, classification, tool calls, reply) with its timing, so that I can find what is slow.
62. As an admin, I want to see which model answered a Run and which models failed before it and why, so that I can tune my model list.
63. As an admin, I want to see each tool call's endpoint, HTTP status and latency, so that I can debug Queries.
64. As an admin, I want to see the error and the stage it happened at for failed Runs, so that I can fix problems quickly.
65. As an admin, I want Runs awaiting a Clarification clearly marked, so that I know which messages are still waiting.
66. As an admin, I want totals (messages per day, counts by Note/Task/Query, failure rate, average time per stage, how often fallback happened), so that I can spot trends.
67. As a non-admin User, I want to be denied access to the observability dashboard, so that other Users' Transcripts stay private.

### User portal

68. As the owner, I want the first admin created automatically from configuration when no Users exist, so that I can log in the first time.
69. As an admin, I want to create a User with a username, password and admin flag, so that I can let someone in.
70. As an admin, I want to add and remove a User's Channel Identities, so that the same person can be recognised on Telegram now and other Channels later.
71. As an admin, I want to reset a User's password, so that I can help someone who is locked out.
72. As an admin, I want to set each User's timezone, so that their Reminders arrive at the right local time.
73. As an admin, I want to delete a User, so that they lose access to both the bot and the dashboard.
74. As the owner, I want passwords stored only as secure hashes, so that a database leak doesn't expose them.

### Running it

75. As the owner, I want to run the whole thing locally with one command, so that I can develop without deploying.
76. As the owner, I want the bot to use long polling locally and a webhook when deployed, controlled by configuration, so that I don't need a public URL to develop.
77. As the owner, I want all secrets and settings to come from environment variables, so that nothing sensitive is committed.

## Implementation Decisions

- **One Node.js + TypeScript package**, one Fastify server hosting the webhook route, the Inventory API routes and the dashboards. No monorepo.
- **Channel-neutral core** (ADR 0005). The core never depends on a channel library. Its single entry point accepts an inbound message in a channel-neutral shape: the sender's Channel and Channel ID, the Channel's message ID, and either audio (a way to fetch it plus its duration), text, or a Clarification answer referring to an earlier Run. It produces a sequence of channel-neutral events: processing started, result (Note saved / Task saved / Query answer / refused / error), and Clarification needed (with the options Note, Task, Query). Each Channel adapter maps these events to what its Channel can do: edit vs send new message, buttons vs a text question that accepts "1/2/3" or the option name.
- **Telegram adapter** built with grammY. Mode chosen by configuration: long polling locally, webhook when deployed. Clarification uses inline buttons; the processing reply is edited with the result.
- **No job queue and no Redis.** The adapter acknowledges the incoming update immediately and the core processes the message in the background within the same process. A message being processed when the process restarts is lost and must be resent; accepted for v1.
- **Deduplication**: a message is identified by Channel + chat + Channel message ID; a repeated delivery of an already-seen message is ignored.
- **Access check**: the sender's Channel + Channel ID must match a Channel Identity on some User; otherwise the bot replies with a refusal and does no further work. Users replace any environment-variable allow-list.
- **Transcriber module**: converts the audio to 16 kHz mono WAV with ffmpeg and runs the whisper.cpp command-line program as a child process with an English-only model (default `small.en`, configurable by model path). Audio files are deleted after transcription, whether it succeeded or failed. Messages over 5 minutes are rejected before download.
- **LLM module** over OpenRouter's chat-completions API with tool calling (ADR 0001). The ordered model list comes from configuration; every model in it must support tool calling. Fallback triggers on request errors (rate limit, server error, timeout) and on unusable answers (invalid JSON, unknown tool, missing required fields), trying the next model each time. When all fail, the result is an error event. Each attempt is recorded on the Run.
- **Classification**: the model must choose exactly one of Note, Task, Query, or "unclear". For Note it returns a Heading; for Task a Heading, a Description and an optional due date with an optional time, interpreted in the User's timezone (one Task per message, Heading names the most important item, Description covers everything); for Query it calls Inventory tools and then writes a plain-language answer. A request to list the User's own Tasks is recognised as its own outcome and answered with the Task list (see **Listing Tasks**). A request to change Inventory data is answered with a polite "not supported yet". "Unclear" raises a Clarification; the chosen answer re-runs the remaining steps with the type fixed. A pending Clarification never times out.
- **Listing Tasks**: when the User asks to see their Tasks, the reply lists all of that User's Tasks and no one else's: open Tasks first (soonest due first, then those with no due date), then done Tasks marked as done, each showing its Heading and due date. With no Tasks, the reply says so plainly. The list is read from MongoDB directly, not through a model tool. A long list is cut to fit a single Channel message and ends by saying how many more there are and pointing to the dashboard. The core emits it as a channel-neutral result event carrying the Tasks; each adapter formats it.
- **Inventory tools**: exactly two predefined tools, *search items* (optional name substring, category, location, low-stock flag) and *get item* (by SKU). The model never builds URLs. Tools make real HTTP requests to the configured Inventory base URL with the configured API key (ADR 0002).
- **Inventory API** (dummy, in-app, read-only): items have SKU, name, category, quantity, unit price and location; about 25 items loaded from a seed JSON file into memory at startup, never stored in MongoDB. Endpoints: list items with optional filters (name partial match, category, location, low stock = quantity below a fixed threshold) and get one item by SKU (404 if missing). Requests without the right API key get 401.
- **Storage**: MongoDB Atlas (ADR 0004). Separate collections for Users (username, password hash, admin flag, timezone, Channel Identities), Notes (owner, Heading, text, original Transcript, created and updated times, source Run), Tasks (owner, Heading, Description, optional due date-time, open/done, Reminder sent time, originating Channel Identity, Transcript, created and updated times, source Run), Runs, and processed message IDs for deduplication (may be folded into Runs).
- **Run record** (ADR 0003): one document per inbound message, holding the Channel and sender, status (in progress / succeeded / failed / awaiting Clarification / refused), resulting type, and an ordered list of stages, each with start time, duration, outcome and details: transcription (model, Transcript length), every model attempt (model, outcome, failure reason, tokens, cost where reported), every tool call (tool, endpoint, HTTP status, latency), the reply, and any error with the stage it happened in.
- **Reminders**: an in-process scheduler (no queue, consistent with the rest of v1) checks every minute for open Tasks whose due moment has passed and whose Reminder hasn't been sent. A date-only due date means 09:00 on that day in the owner's timezone. Each Reminder is claimed atomically in MongoDB before sending, so it goes out exactly once even if checks overlap, and because the state lives in the database, Reminders missed while the process was down go out on the next start. The core emits a channel-neutral Reminder event addressed to the Channel Identity the Task came from; the Telegram adapter renders it with a "Done" button, and other Channels send plain text. Marking a Task done prevents its Reminder; changing its due date clears the sent marker so a new Reminder is scheduled. Each User's timezone is set in the portal, defaulting to a configured timezone. Reminders are sent once, at the due moment only.
- **Editing**: a Note's Heading and text can be edited; the original Transcript is kept unchanged alongside it, so the Transcript stays verbatim. A Task's Heading, Description and due date can be edited. Editing happens in the dashboard only.
- **Dashboards**: server-rendered EJS pages from the same Fastify app, using plain HTML forms with redirect-after-post (no frontend build, no htmx). Pages: Notes (list, search, view, edit, delete), Tasks (Open/Done tabs, mark done/reopen, edit, delete), Observability (admin only: Run list, Run detail, totals), Users portal (admin only: create User, add/remove Channel Identity, set timezone, reset password, delete User). Each User only ever sees their own Notes and Tasks.
- **Dashboard auth**: HTTP basic auth checked against Users in MongoDB; passwords hashed with Node's built-in scrypt and a per-user salt, compared in constant time. On startup, if no Users exist, one admin is created from `ADMIN_USERNAME`, `ADMIN_PASSWORD` and a Telegram Channel Identity from `ADMIN_TELEGRAM_ID`.
- **Configuration** comes entirely from environment variables (Telegram bot token, bot mode, webhook URL, MongoDB connection string, OpenRouter API key and model list, whisper model path, Inventory base URL and API key, first-admin values, default timezone), validated at startup with a clear error for anything missing.

## Testing Decisions

- **Good tests check external behaviour only**: what a User or admin would observe (events sent back, records saved, pages returned, HTTP responses), never internal function calls or private structure. Tests must survive refactoring of the internals.
- **Test runner**: Vitest.
- **Seam 1, the core entry point (primary seam)**: tests feed channel-neutral inbound messages to the core and assert on the events produced and on what ends up in storage. Test substitutes:
  - a fake Transcriber returning a fixed Transcript,
  - a fake OpenRouter returning scripted responses per model (successes, failures, malformed tool calls, "unclear"),
  - the real Inventory API routes on a random port, so tools make real HTTP calls,
  - a real in-memory MongoDB (`mongodb-memory-server`), not mocked repositories.

  Covers: Note/Task/Query routing, Headings/Descriptions/due dates, Query answers and empty results, listing Tasks (own Tasks only, ordering, done marked, none saved, truncation), Command refusal, Clarification raised and answered, unknown senders refused, duplicates ignored, the 5-minute limit, model fallback and total failure, and Run records for each case.
- **Reminders through Seam 1**: the core also exposes a "send due Reminders as of time T" operation that the scheduler calls every minute. Tests call it directly with a chosen time, so there's no real clock or waiting. Covers: due at a set time, date-only at 09:00 in the User's timezone, exactly-once sending, done Tasks skipped, overdue Reminders sent after downtime, a changed due date producing a new Reminder, and the Reminder addressed to the originating Channel Identity.
- **Seam 2, the Fastify app over HTTP**: tests use Fastify's in-process request injection (no network) against a real in-memory MongoDB. Covers: the Inventory API contract (filters, 404, 401), basic auth (missing, wrong, correct), Users seeing only their own Notes and Tasks, Task done/reopen, editing Notes and Tasks (with the original Transcript unchanged), deletes, setting a User's timezone, admin-only access to Observability and the Users portal, User and Channel Identity management, password reset, first-admin creation, and the webhook route handing updates to the adapter.
- **Outside the default suite**: one optional slow test runs the real Transcriber (ffmpeg + whisper.cpp) on a short sample audio file, skipped when the tools or model aren't installed. The Telegram adapter's mapping is thin and is covered only through the webhook test.
- **Prior art**: none. The repo has no code yet; these tests set the pattern.

## Out of Scope

- Deployment (Render or anywhere else). v1 runs locally only.
- Saving Notes to Obsidian or any external note store.
- Commands (any change to Inventory data).
- Advance warnings, repeating Reminders, snoozing, and Reminders by email or any route other than a Channel.
- Asking about your own Notes by voice, and asking about your Tasks beyond listing them all (no searching, filtering or editing them from a Channel). A Query covers the Inventory only.
- WhatsApp and MCP Channels (the core is designed for them, but only the Telegram adapter is built).
- Self sign-up, changing your own password, and Telegram Login for the dashboard.
- Languages other than English.
- A job queue, retries after a process restart, and horizontal scaling.
- A real inventory system.
- Editing Notes or Tasks from a Channel (editing is dashboard-only).

## Further Notes

- Domain vocabulary is defined in `GLOSSARY.md`; decisions are recorded in `docs/adr/` (0001 OpenRouter fallback list, 0002 inventory tools call own API over HTTP, 0003 in-house observability, 0004 MongoDB Atlas, 0005 Channel-neutral core).
- Local prerequisites not yet installed: ffmpeg and whisper.cpp (`brew install ffmpeg whisper-cpp`) plus a downloaded `small.en` model. The owner also needs a Telegram bot token, a MongoDB Atlas cluster and an OpenRouter API key; a `/wizard` script can walk through these.
- The repo is named `vlm_agent`; the project is referred to as "Voice Notes Bot" in the glossary.
- When the project is later deployed to a small server (e.g. Render's free plan, 512 MB RAM / 0.1 CPU), transcription speed and memory are the main risk; measure a smaller whisper model there before committing.
