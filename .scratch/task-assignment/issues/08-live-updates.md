# 08: Live updates

**What to build:** Server-Sent Events: `/assign/events` streams the owner's events to the Board, and `/l/<code>/events` streams one Assignment's changes to its link page, through an in-process hub, after each change is saved. Pages apply events without a refresh, and show a live alert on the Board when an assignee marks a Task done or blocked or first opens a link. A reconnect with `Last-Event-ID` replays missed events, or gets a `reset` that makes the page refetch. See spec story 19 and **Events**, **Live updates**.

**Blocked by:** 07

**Status:** ready-for-agent

- [ ] An assignee's change reaches an open Board stream, and an owner's change reaches the open link page stream, as events whose IDs are the `ta_events` sequence numbers.
- [ ] An owner's stream never carries another owner's events; an assignment stream carries only its own List's.
- [ ] A change is in `ta_events` before it's broadcast.
- [ ] Reconnecting with `Last-Event-ID` replays exactly the later events; an unknown ID or one over 500 events behind gets a `reset`.
- [ ] A revoked or reassigned link's open stream gets a `revoked` event and closes, and the page shows "no longer available".
- [ ] Manually: ticking a Task on a phone shows on the Board in a laptop browser within 2 seconds, with an alert.
