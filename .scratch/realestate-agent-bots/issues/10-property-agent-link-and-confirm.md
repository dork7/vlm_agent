# 10: Property Agent linking and Confirm/Decline

**What to build:** Let the operator link a Property Agent to a bot: console shows a one-time code, the Property Agent sends it to the bot, and their Telegram ID is stored. On a new Appointment request, message the Property Agent with Customer, Listing and time and Confirm / Decline buttons. Confirm or Decline updates the state and notifies the Customer. Spec stories 18, 19, 22.

**Blocked by:** 05, 09

**Status:** done

- [ ] Linking code is single-use and expires.
- [ ] Only the linked Property Agent's button presses change an Appointment; others are ignored.
- [ ] Double-tap or late press on a decided Appointment does nothing and says so.
- [ ] Customer is notified of confirmation or decline.
- [ ] No Property Agent linked: Customer is told booking is unavailable and the operator sees a warning.
- [ ] Covered by tests with a fake Telegram client.
