# Voice Notes Bot

A bot that turns a person's spoken voice messages into Notes, Tasks and Inventory answers, reachable through any Channel.

## Language

**Channel**:
A messaging service through which people talk to the bot, such as Telegram, WhatsApp or an MCP client.
_Avoid_: Platform, integration, transport, bot

**User**:
A person with an account who may use the bot and the dashboard, independent of any Channel.
_Avoid_: Member, account, customer, Telegram user

**Channel Identity**:
A User's ID on one particular Channel, which is how the bot recognises who sent a message.
_Avoid_: Telegram ID, handle, external account

**Voice Message**:
An audio message a person sends to the bot through a Channel.
_Avoid_: Recording, audio, memo, voice note

**Transcript**:
The verbatim written text of what was said in a Voice Message.
_Avoid_: Transcription, text, note

## What a Voice Message asks for

Every Transcript is understood as exactly one of the following.

**Note**:
Something the person wants remembered, kept for later reading.
_Avoid_: Memo, entry, idea

**Task**:
Something the person intends to do later, kept as an open to-do.
_Avoid_: Todo, reminder, action item

**Query**:
A request to look up information held in an Inventory, answered with a reply.
_Avoid_: Request, question, lookup

**Command**:
A request to change information held in an Inventory. Not supported yet.
_Avoid_: Action, update, write

**Heading**:
A short AI-written line naming the most important point of a Note or Task.
_Avoid_: Title, subject, summary

**Description**:
The AI-written detail of what a Task involves, beneath its Heading.
_Avoid_: Body, details, notes

**Reminder**:
A message the bot sends a User, on the Channel a Task came from, when that Task falls due.
_Avoid_: Notification, alert, ping

**Clarification**:
The bot asking the person whether an unclear Voice Message is a Note, Task or Query.
_Avoid_: Disambiguation, prompt, follow-up

## Observability

**Run**:
One pass of a single Voice Message through the bot, from arrival to the final reply, including every stage and failure along the way.
_Avoid_: Job, trace, execution, request

## Inventory

**Inventory**:
The stock of items, with their quantities, that the bot can look up on the person's behalf.
_Avoid_: Stock, catalogue, warehouse
