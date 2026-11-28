# 11: Ask for and relay the apartment location

**What to build:** After a confirm, ask the Property Agent to share the apartment's location. When they send a Telegram location pin for that Appointment, relay it to the Customer and set the state to location-shared. Location is never sent before confirmation. Spec stories 20, 21.

**Blocked by:** 10

**Status:** done

- [ ] Property Agent is prompted right after confirming.
- [ ] A pin is matched to the correct open Appointment (handles several pending ones).
- [ ] Customer receives the pin with the Listing and time.
- [ ] Pins for unconfirmed or already-shared Appointments are not relayed.
- [ ] Covered by tests with a fake Telegram client.
