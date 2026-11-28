# 09: Appointment request and state machine

**What to build:** Add the `appointments` collection and a state machine (requested, confirmed, declined, location-shared) with guarded transitions. Give the engine a `book_appointment(listingId, datetime)` tool the LLM calls after the Customer shows interest and gives a time; the bot offers viewings per the Conversation Guide. Customer is told the request is waiting. Spec stories 16–18.

**Blocked by:** 03

**Status:** done

- [ ] Bot offers a viewing after interest in a Listing and accepts free-text dates/times.
- [ ] Past or unparseable times are rejected and asked again.
- [ ] Only valid state transitions succeed; repeated transitions are no-ops.
- [ ] The LLM can create a request but cannot confirm, decline or share location.
- [ ] Covered by engine tests with a fake LLM.
