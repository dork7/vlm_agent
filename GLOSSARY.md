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
One pass of one inbound message (typed text, Voice Message, or Clarification answer) through the bot, from arrival to the final reply, including every stage and failure along the way.
_Avoid_: Job, trace, execution, request

## Inventory

**Inventory**:
The stock of items, with their quantities, that the bot can look up on the person's behalf.
_Avoid_: Stock, catalogue, warehouse

## Task assignment (separate module)

These terms belong to the Task assignment module in `src/assign/` only; it shares no data with the bot's Users, Notes or Tasks.

**Owner**:
A person with a Task assignment account (email login) and a private workspace. Not the same as a bot User.
_Avoid_: User, admin, manager

**Assigned Task**:
One thing to do in an Owner's workspace: a title, tags, an optional instruction, an optional Deadline, one Note, and a status of open, blocked or done. Called "Task" inside the module.
_Avoid_: Job, item, to-do

**Note**:
The single free-text field on an Assigned Task where the Owner or Assignee says anything about it, including what is blocking it. Replaces the former separate blocked reason. Not the same as a bot Note.
_Avoid_: Blocked reason, comment, reason

**Deadline**:
The optional date and time by which an Assigned Task should be done; when only a date is given, the time is the end of that day.
_Avoid_: Due date, due time, expiry

**List**:
A named group of an Owner's Assigned Tasks; an Assigned Task is in at most one List at a time.
_Avoid_: Checklist, group, project

**Additional Task**:
An Assigned Task added to a List after that List was assigned; Tasks added before assignment are not. Shown with an "Additional task" tag.
_Avoid_: New task, late task, extra task

**Removed Task**:
A Task taken out of an assigned List, or deleted, after assignment; the Assignee still sees its title marked "Removed", with nothing to act on.
_Avoid_: Deleted task, cancelled task

**Person**:
Someone an Owner gives Lists to, known only by a name; never has an account.
_Avoid_: Contact, worker, member

**Assignee**:
A Person while using an Assignment's link page.
_Avoid_: Guest, viewer

**Assignment**:
One List given to one Person, with its own unguessable, revocable link.
_Avoid_: Share, invite, link

**Board**:
The Owner's overview of who is doing what, with the activity feed.
_Avoid_: Dashboard, overview
