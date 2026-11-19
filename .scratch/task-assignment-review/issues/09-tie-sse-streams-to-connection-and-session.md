# 09: Tie SSE streams to connection and session lifetime

**What to build:** A client that disconnects while the stream is still replaying `Last-Event-ID` events releases its hub listener and heartbeat timer; a failure during setup does not leave a listener registered. Owner streams end when the session is logged out, signed out everywhere, has its password changed or is revoked, rather than delivering activity until the socket closes. Concurrent streams per Owner and per link have a sensible cap. Assignee isolation does not depend only on a per-event `listId` filter (the report suggests a per-List channel key as one option).

The session-closing and per-List channel parts are Low/Medium and the leak race itself was not reproduced; treat as likely.

**Blocked by:** None

**Status:** needs-triage

**Severity:** Medium

**Source:** [code-review](../../task-assignment-refresh/reviews/code-review.md) F5 SSE listener/heartbeat leak when the client disconnects during setup (Likely); [security-review](../../task-assignment-refresh/reviews/security-review.md) F6 SSE streams are not tied to session or link lifetime; possible listener leak (leak race not reproduced)

**Acceptance criteria:**

- [ ] Closing the connection during replay leaves zero listeners on the hub and no running heartbeat (observable in a test).
- [ ] An error thrown during setup removes the listener.
- [ ] After logout / logout-all / password change, an open Owner stream is closed.
- [ ] More streams than the cap for one Owner or link are refused or evict the oldest.
- [ ] Covered by tests through the existing HTTP workflow test seam.
