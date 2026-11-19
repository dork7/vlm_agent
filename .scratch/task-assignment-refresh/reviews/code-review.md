# Code review: Task assignment module (branch task-assignment-refresh)

Scope: src/assign/ (workflow.ts, store.ts, auth.ts, sse.ts, events.ts, config.ts, views), the diff vs main (small: workflow.ts +40/-, theme.ejs +1, tests +541), and test/assign/. Read-only; I did not run the vitest suite (baseline failures known). Findings marked Confirmed were reproduced with a throwaway script (scratchpad `probe.mts`, in-memory Mongo, nothing in the repo touched).

## Summary

The authorization story is solid: every Owner route scopes by `ownerId` (ownTask/ownList/ownerOf), and every Assignee route resolves an active Assignment and then scopes the Task to `assignment.listId`. No cross-Owner or cross-List access found. The problems are in non-atomic multi-step Mongo updates (add/remove Tasks, `taskCount`, Removed rows, `assignList`) and in the SSE/session interaction.

Confirmed bugs worth fixing before merge:
1. A double-submitted "add Tasks" silently removes the Tasks from the List and leaves `taskCount` wrong (High).
2. A double-submitted "Remove" double-decrements `taskCount` and writes duplicate Removed rows (Med).
3. The SSE endpoint rotates the refresh token but its `Set-Cookie` is dropped by `hijack()`, so the browser keeps a rotated token and the next request after 30 s revokes every session of the Owner (High).
4. Editing a Task cannot clear a Deadline (400) because the prefilled time remains (Med).

Most of the diff vs main (Overdue badge, Removed `$pull` moved after attach, Person cleanup in `assignList`, collapsed rows) is correct in the single-request path. The two diff-related concerns are the new `$pull` placement (F7) and the Person cleanup race (F6).

## Findings

### F1. Concurrent/double "add Tasks" rolls back the other request's attachments, corrupting List and `taskCount` — High, Confirmed
- `src/assign/workflow.ts:147-150` (`addTasks`).
- Scenario: the same add form is submitted twice (double click, two tabs, retry). Both requests pass the read-side checks at :144-145. Both reserve `taskCount` (:147). Request 1's `updateMany` (:149) attaches all Tasks. Request 2's `updateMany` matches none (`listId: {$exists:false}` fails), so `modifiedCount !== ids.length`, and the rollback at :150 runs `updateMany({listId: list._id, _id: {$in: ids}}, {$unset: {listId, addedToListAt}})`. That matches the Tasks request 1 just attached to the same List, so it detaches them, then decrements `taskCount` by only one request's worth.
- Reproduced: two parallel `POST /assign/lists/:id/add` with tasks b,c gave statuses [303, 400]; afterwards `taskCount = 3` but only 1 Task actually in the List. Request 1 reported success and emitted `list.add` events (:152 is not reached by request 2, but request 1's events fire) for Tasks that are no longer in the List. No Removed row, no feed entry for the detach. The same flaw hits `POST /assign/lists` rollback at :~215 (`updateMany({listId: list.insertedId}...)` is safe there because the List is new, so only addTasks is affected).
- Fix: make the attach per-Task and attributable: loop `updateOne({_id, ownerId, listId: {$exists:false}}, ...)` collecting successes, and on any miss roll back only those ids. Or tag the attach with a unique `attachToken` and unset by that token. Better: wrap reserve+attach in a Mongo transaction (replica set is required by Atlas anyway per ADR 0004), or derive `taskCount` from `countDocuments` instead of storing it. Also add `ownerId` to the rollback `$inc` filter (:150, second update has none).

### F2. Concurrent/double "Remove" double-decrements `taskCount` and duplicates Removed rows — Med, Confirmed
- `src/assign/workflow.ts:268-273` (route) and :108-119 (`removedTask`).
- Scenario: double-click Remove. Both requests `findOne` the Task still in the List (:271), both `$unset listId` (:272, unconditional), both run `removedTask`: `$inc taskCount -1` twice (:112); the pull-then-push pair (:112 `$pull`, :114 `$push`) interleaves so two `{taskId}` rows get pushed.
- Reproduced: removing one Task twice in parallel dropped `taskCount` by 2 and left 2 Removed rows for the same Task. Consequences: the 50-Task cap check (`taskCount` based, :143/:147) lets a List exceed 50 Tasks; the Assignee sees a duplicated Removed row and gets two "Task removed" events/banners; completion/progress unaffected (computed from live Tasks) but the sidebar and /assign/lists use `taskCount`.
- Same race exists between Delete Task (:~371) and Remove, and `deleteOne` then `removedTask` use a stale `task.listId`.
- Fix: gate on the transition: `const r = await tasks.findOneAndUpdate({_id, ownerId, listId: list._id}, {$unset:{listId:""}}, {returnDocument:"before"})`; only if `r` is non-null run `removedTask(r)`. For delete use `findOneAndDelete` and use its returned doc. Make Removed-row write a single update (`$pull` then `$push` in one pipeline update, or `$push` after `$pull` guarded by `removedTasks.taskId: {$ne: id}`).

### F3. SSE endpoint loses the rotated refresh cookie; next request after 30 s revokes all sessions — High, Confirmed
- `src/assign/sse.ts:47-50` calling `currentOwner(ctx, request, reply)`, then `stream()` at :12-13 does `reply.hijack()` + `reply.raw.writeHead(200, {...})`; `src/assign/auth.ts:29-33` sets the new refresh/access cookies via `reply.header`.
- Scenario: a tab stays open past the 15-minute access-JWT lifetime; the EventSource reconnects (network blip, proxy timeout, server restart). `/assign/events` is the first authenticated request, so it takes the refresh path: inserts a new token, marks the old one `rotatedAt`, and sets cookies. Because the reply is hijacked and headers are written by hand, none of those `Set-Cookie` headers reach the browser. The browser keeps the old refresh token. Once more than 30 s pass, the next request with it hits `auth.ts:14-17` (rotated and older than 30 s), which treats it as theft and revokes every refresh token of the Owner: forced logout on all devices.
- Reproduced: `GET /assign/events` with an expired/absent access cookie returned 200, `set-cookie: null`, while the DB shows the old token marked rotated and a new one inserted.
- Fix: in `/assign/events`, do not rotate (`currentOwner(ctx, request)` without `reply`, i.e. accept only a valid access JWT and respond 401/`reset` so the page reloads and refreshes via a normal request), or copy `reply.getHeaders()` (set-cookie) into `writeHead`. Independently, soften `auth.ts:14` so a rotated-but-unrefreshed token gets re-rotated instead of nuking all sessions when the access JWT is still valid (note the check runs before the JWT check at :18).

### F4. Edit Task cannot clear a Deadline — Med, Confirmed
- `src/assign/workflow.ts:73-75` (`deadlineFrom`) with edit page script at :~190.
- Scenario: the edit form is prefilled with date and time by script. The Owner clears the date input but the time input keeps its value. `deadlineFrom` returns `"invalid"` when time is present without date, so `POST .../edit` returns 400 "Invalid Deadline." Reproduced (400). The Owner must know to also clear the time. Spec story 6 ("edit a Task's Deadline later") and the test "lets the Owner change and clear a Deadline" only clear by sending both empty.
- Related (Low/Possible): without JavaScript the edit form's date/time are not prefilled, so saving any other edit (title) sends empty deadline fields and `:~232` unsets the existing Deadline silently. Consider an explicit "Clear Deadline" control and keeping the old value when the date field was never populated (e.g. hidden `deadlineSet` flag).
- Fix: treat time-without-date as "no deadline" on edit when date is empty, or clear the time input in script when the date is cleared; add an explicit clear control.

### F5. SSE listener/heartbeat leak when the client disconnects during setup — Med, Likely
- `src/assign/sse.ts:28, 32-44`.
- `hub.on(ownerId, onEvent)` is registered at :28, then two `await`ed Mongo queries run (:33-34, :37) before `reply.raw.on("close", ...)` is attached at :44. If the client disconnects during those awaits (reconnect storms, page navigations; `Last-Event-ID` reconnects always hit this path), `close` has already fired, so the handler never runs: the `hub` listener and the 20 s heartbeat interval (started at :43) live forever and write to a destroyed socket. `setMaxListeners(0)` hides the growth. Fix: attach the `close` handler immediately after `hijack()`, before any await, and clear the interval from there; check `reply.raw.destroyed` before starting the interval.
- Also: a failure in the awaits throws after `hijack()` leaving the listener registered (unhandled rejection); wrap in try/finally.

### F6. `assignList` Person cleanup can delete a Person another request just attached — Low/Med, Likely
- `src/assign/workflow.ts:121-140` (new in this branch).
- Scenario: two concurrent assigns of the same List to a brand-new name. Request 1 inserts the Person (`createdPersonId` set); request 2's insert hits the unique index and reuses it. The partial unique index on active Assignment makes one of them fail; if request 1 is the loser it deletes the Person (:138) that request 2's winning Assignment references. `/l/:code` then renders the revoked message (person missing, :~296) for an active link, and the Owner page shows "someone".
- Also in the catch at :132: restoring `previous` via `updateOne(... active:true)` itself throws a duplicate-key error if the winner already holds the active slot, masking the original error (harmless but noisy).
- Fix: only delete the Person if no Assignment references it (`countDocuments({personId})===0`) or do not delete on cleanup at all. In `POST /assign/lists` the rollback path deletes the List and Tasks anyway.

### F7. Removed row cleared after attach, non-atomically — Low, Likely (diff change)
- `src/assign/workflow.ts:149-151` (diff moved `$pull removedTasks` out of the reservation).
- Between the attach (:149) and the `$pull` (:151) a re-added Task appears both as a live Task and as a Removed row; if the `$pull` or process fails, the row persists permanently beside the live Task (no retry). Fix: do the `$pull` before/with the reservation (as before the diff) and re-`$push` in the rollback, or make the pull part of the same update; the old placement had the opposite flaw (row cleared even if attach failed), so a transaction is the clean answer.

### F8. Additional Task decision uses a stale List snapshot — Low, Possible
- `src/assign/workflow.ts:149` uses `list.firstAssignedAt` read before the writes. If the List is first assigned between the route's `ownList` read and the attach, the Task gets no `addedToListAt` and is presented as an original Task, and `list.status` (:152) is also stale so no `list.add` event/banner is sent. Mitigate by re-reading, or by setting `addedToListAt` unconditionally and deriving the tag from `>= firstAssignedAt` (the display already compares times, so setting it always is safe and removes the race).
- Similarly stale `addedToListAt` is never cleared on remove/delete-List; harmless today only because later `firstAssignedAt` values are always later. Clear it in the remove path.

### F9. Status change is a read-modify-write with no precondition — Low, Confirmed by reading
- `src/assign/workflow.ts:89-100`. The transition check uses the `task.status` read earlier, but the update at :95 filters only `_id/ownerId`. Two concurrent clicks (Owner and Assignee, or double click) both pass and record two `task.status` events; Open->Done racing Done->Open can leave a status that the validity matrix forbids (e.g. Done and Blocked requests both from Open: last write wins, no error). Add `status: before` to the update filter and return "Invalid status transition" when nothing matched.
- Also: `toValue` includes the retained old Note for Done/Open transitions (`${status}: ${savedNote}`, :96), so the feed reads "Task: done: <stale blocker text>" (spec story 44 only wants the Note shown where the blocked reason was). Include the Note only for `blocked`.
- The Note clobber: Blocked posts the (possibly stale) prefilled textarea, overwriting a Note saved in the meantime by the other party.

### F10. Notes over 2000 characters make status changes fail (migration and CRLF) — Low/Med, Possible
- `src/assign/workflow.ts:90` (`textLimit(note, 2000)` on every status POST) plus `src/assign/store.ts:18-22` (migration).
- Every status button posts the hidden Note textarea (the Blocked box lives inside the same form, `statusForm`). The migration concatenates `blockedReason + "\n\n" + note`; if the combined text exceeds 2000, `maxLength` does not truncate a prefilled textarea, so every Done/Reopen/Blocked post returns "Note is too long." and the Task is stuck. Browsers also submit textarea newlines as CRLF, so a legitimate Note near the limit with line breaks exceeds 2000 server-side though the browser counted fewer. Fix: validate only when status is `blocked` and the Note changed, truncate/trim in the migration, normalise `\r\n` before measuring.
- Migration (`store.ts:17-22`) is idempotent (guarded `updateOne` with `blockedReason: {$exists:true}`), but scans the collection without an index on every app start, and folds stale blocked reasons from Tasks that are no longer blocked (if old code left `blockedReason` after Reopen) into the Note (Possible).

### F11. Rotated-token handling: duplicate refresh tokens per request, all-session revoke on slow clients — Low, Likely
- `src/assign/auth.ts:13-35`, `46-48`. `requireOwner` and then the handler call `currentOwner` with the same stale cookies; the second call sees `rotatedAt` (<30 s) and rotates again, inserting another token and a second pair of `Set-Cookie` headers (affects /assign/password-offer, /assign/settings/password, /assign/logout-all). Also a legit client that missed the response (mobile network drop) and retries after 30 s loses all of its sessions on every device. Consider restricting the revoke to the token's `family` instead of `ownerId`.

### F12. Smaller issues — Low
- `src/assign/sse.ts:35`: `latest.seq - last > 500` compares per-Owner latest seq to the global counter, so busy installs (other Owners' events consume sequence numbers) produce `reset` earlier than intended; harmless (reload) but the intent ("more than 500 of this Owner's events") is not what is implemented. Use a count of the Owner's events after `last`.
- `src/assign/sse.ts:24`: an `assignment.revoke` event emitted by a reassign (`workflow.ts:135`) happens after the new Assignment is inserted (:131); an Assignee who opens the new link and connects within that window receives `revoked` on the new link's stream (the stream filters only by List) and reloads. Narrow. Fix: carry the Assignment id in the event and match it on the stream.
- `src/assign/workflow.ts:~250-257` Remove/Add completion: `addTasks` unsets `completedAt` but if the added Task is already Done on an otherwise all-Done List, the List stays un-completed until a status change; call `syncCompletion` at the end of `addTasks`.
- `src/assign/workflow.ts:218-224`: `POST /assign/lists` attaches Tasks before validating the Person name length (:221); the rollback works but is avoidable, and `list.create` is recorded after `assignment.create` (feed order).
- `src/assign/workflow.ts:171-173` the List creation attaches Tasks without setting anything for stale `addedToListAt` (see F8).
- Events: `recordEvent` after the data write means a failure there returns 500 though the change persisted; `task.edit` event omits the Deadline from from/to values; Overdue is computed at render time only, so a Task becoming overdue while the page is open is not flagged until some other event reloads it (spec only requires render-time derivation).
- `src/assign/auth.ts:98-99`: password login does no hashing for unknown emails, so response time reveals whether an account has a password (Low); the per-email rate limit (:97) lets anyone lock out an Owner's password login for 15 minutes (email link still works). `src/assign/rate-limit.ts` never prunes keys (slow memory growth).
- `src/assign/index.ts:34-40` CSRF is a plain double-submit cookie (unsigned, not bound to the session): fine for SameSite=Lax same-site threat models, weak against cookie injection from a sibling subdomain. Assignee POSTs under `/l/` have no CSRF, acceptable because the link code is the credential.
- `src/assign/workflow.ts` `fail`/inactive-link pages: stale Assignee posts return HTTP 200 with the revoked page (matches spec story 63, but means clients/tests cannot detect failure by status).
- Board query params (`tag`, `person`, `status`) may arrive as arrays; they are only compared/escaped so nothing breaks, but the filter silently matches nothing.

## Things checked and found correct
- Owner routes: every `/assign/*` handler goes through `ownerOf`; Task/List/Person lookups include `ownerId`; add/remove/status/note updates include `ownerId` (one `$inc` rollback at :150 lacks it, no cross-Owner effect since `_id` is unique).
- Assignee routes validate the 10-char code, require `active: true`, and scope the Task by `listId`; a removed or other-List Task returns 404.
- XSS: all user text goes through `esc`, the inline script interpolates only the validated code and `JSON.stringify`ed paths; SSE data is rendered with `textContent`.
- Deadline parsing: offset sign is right (UTC = local + getTimezoneOffset), calendar round-trip rejects 30 Feb/24:00, offset bounded to +/-840, time-without-date rejected. Date-only defaults to 23:59 in the submitted offset; without script it silently becomes UTC (acceptable fallback).
- Overdue: derived (`deadline < now && status !== done`) in both the summary and the expanded row; never stored. Done is excluded.
- Status transition matrix matches spec (open->blocked/done, blocked->open/done, done->open). Blocked->Blocked is rejected, and the UI never offers it (the "Save Blocked" button is only reachable after clicking Blocked on an Open Task).
- Additional tag logic (`addedToListAt >= firstAssignedAt`) survives revoke/reassign because `firstAssignedAt` is only set when absent; draft additions emit no event.
- Event ordering: counter then insert then emit; listeners filter by `listId`, assignee stream ends on revoke/delete kinds; replay is de-duplicated through `seen`.
- Migration is idempotent for the both/reason-only/note-only/neither cases.

## Test gaps
- No concurrency tests for add/remove/assign/status (F1, F2, F6, F9). The one concurrency test ("counts two simultaneous first views once") covers views only. The add rollback test ("leaves no List... when creation is rejected") covers the create-list path, not `addTasks` rollback.
- No test that `/assign/events` with an expired access token returns usable cookies, or that a stale refresh does not revoke all sessions (F3). login.test.ts covers rotation only through normal routes.
- No test of clearing a Deadline when the time field is still populated, or editing with JavaScript disabled (F4). The existing clear test sends both empty.
- No test for `taskCount` consistency after remove/delete/add, nor the 50 cap after remove (F2). The 51st-Task test builds the List in one request.
- No test of Remove or Delete on a Task that is in no List / already removed (idempotency), nor duplicate Removed rows.
- No test for notes over 2000 characters through a status POST (migration output > 2000) or CRLF newlines (F10).
- Migration test does not cover a Task with `blockedReason` that is not blocked, a combined length over 2000, or a legacy `null` value.
- SSE: no test that a client disconnecting during replay releases its listener (F5); no test of the `Last-Event-ID` > 500 threshold with another Owner's events (F12); no test that the new Assignee's stream is unaffected by the old link's `assignment.revoke`.
- A completed List plus adding an already-Done Task is untested.
- Several Deadline/Overdue tests assert rendered markup strings (`Overdue` present/absent) only for fixed `now`; none uses the injected clock to cross the deadline, so "becomes Overdue as time passes" is unverified.
- Tests that cannot really fail: assertions of the form "markup contains `Additional task`" on a page that always includes the legend/script text should be checked against the specific Task row; I did not find outright vacuous tests, but the view-toggle tests in task-view.test.ts run against hand-built HTML rather than the rendered page.
