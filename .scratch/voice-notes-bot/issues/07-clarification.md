# 07: Clarification

**What to build:** When the model can't tell whether a message is a Note, Task or Query, the bot asks a Clarification instead of guessing. The core emits a channel-neutral Clarification-needed event with the three options. The Telegram adapter shows Note / Task / Query buttons; on a Channel without buttons, the question is asked as text and the User answers with "1/2/3" or the type's name. The answer continues processing the original Transcript as the chosen type. An unanswered Clarification waits indefinitely and is visible as "awaiting Clarification".

**Blocked by:** 02, 04

**Status:** ready-for-agent

- [ ] Through Seam 1, an "unclear" classification produces a Clarification-needed event and saves nothing yet.
- [ ] Answering with each of Note, Task and Query (as a button choice or as text "1/2/3" / the name) completes the original message as that type.
- [ ] While a Clarification is pending on a text-only Channel, a reply that isn't a valid answer gets the question asked again; it is not silently dropped or treated as a new message.
- [ ] A pending Clarification has no timeout and its state is stored so ticket 12 can mark the Run "awaiting Clarification".
- [ ] On Telegram, the Clarification appears as three inline buttons and tapping one completes the message.
