# 07: Clarification

**What to build:** When the model can't tell whether a message is a Note, Task or Query, the bot asks a Clarification instead of guessing. The core emits a channel-neutral Clarification-needed event with the three options. The Telegram adapter shows Note / Task / Query buttons; on a Channel without buttons, the question is asked as text and the User answers with "1/2/3" or the type's name. The answer continues processing the original Transcript as the chosen type. An unanswered Clarification waits indefinitely and is visible as "awaiting Clarification".

**Blocked by:** 02, 04

**Status:** ready-for-agent

- [x] Through Seam 1, an "unclear" classification produces a Clarification-needed event and saves nothing yet.
- [x] Answering with each of Note, Task and Query (as a button choice or as text "1/2/3" / the name) completes the original message as that type.
- [x] While a Clarification is pending on a text-only Channel, a reply that isn't a valid answer gets the question asked again; it is not silently dropped or treated as a new message.
- [x] A pending Clarification has no timeout and its state is stored so ticket 12 can mark the Run "awaiting Clarification".
- [x] On Telegram, the Clarification appears as three inline buttons and tapping one completes the message.
- [ ] Manually: an unclear message on Telegram shows the three buttons, and tapping one completes the message.

## Comments

- Implemented. The model gets an `ask_clarification` tool and calls it only when it can't tell; against the real model (nvidia/nemotron-3.5-super-vl:free) "blue mugs" and "the supplier thing" raised a Clarification while a clear Task, Note and Query did not.
- Stored in a `clarifications` collection (pending / answered, with the Transcript, the original message as `source`, and `answeredBy`), for ticket 12's "awaiting Clarification". `HandledMessage.clarification` says whether the message asked, re-asked or answered one.
- The answer re-runs classification with only that type's tools offered (save_note / save_task / search_items + get_item).
- Each adapter says how its Clarifications are answered (`clarifyWith`, required). Telegram uses "buttons": a tap answers it, and a typed message while one is pending is a new message (the buttons stay usable). On "text" Channels every reply from that User in that chat answers ("1/2/3", "note", "a task", …) or gets the question again; a Voice Message gets the question again without being fetched. No text-only adapter exists yet, so the question's wording for one is left to it.
- A Clarification is answered only once (a second tap, or another User's, does nothing). If completing it fails, it is pending again so the User can answer again; on Telegram the failure reply replaces the buttons, so a retry is by typing the message again.
