# 02: Tasks with Heading, Description and due date

**What to build:** A User says or types something they intend to do ("call the supplier Thursday at 3, and send the invoice") and it is saved as a Task rather than a Note. The model now chooses between Note and Task. A Task has a Heading naming the most important item, a Description covering everything mentioned, an optional due date with an optional time (interpreted in the User's timezone, which defaults to the configured default timezone), open status, the original Transcript and the Channel Identity it came from. One message produces one Task. The reply tells the User the Heading and due date.

**Blocked by:** 01

**Status:** ready-for-agent

- [ ] Through Seam 1, a to-do message produces a Task (not a Note) with Heading, Description, open status, Transcript and originating Channel Identity; the result event names the Heading and due date.
- [ ] A message mentioning several to-dos produces exactly one Task whose Description covers all of them.
- [ ] A date with a time is stored as that moment in the User's timezone; a date without a time is stored as date-only; no date leaves the due date empty.
- [ ] Users have a timezone field defaulting to the configured default timezone.
- [ ] A message meant to be remembered still produces a Note, as before.
