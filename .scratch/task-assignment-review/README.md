# Task assignment review: implementation tickets

Tickets derived from the four review reports in [`../task-assignment-refresh/reviews/`](../task-assignment-refresh/reviews/): code-review, security-review, ui-ux-review, code-smells. Format and statuses follow `docs/agents/issue-tracker.md` and `docs/agents/triage-labels.md`; all tickets start as `needs-triage`.

| NN | Title | Severity | Source reports | Blocked by |
|---|---|---|---|---|
| [01](issues/01-double-submitted-add-tasks-must-not-detach.md) | Double-submitted add Tasks must not detach Tasks or corrupt the List | High | code-review | None |
| [02](issues/02-sse-reconnect-must-not-strand-the-browser.md) | SSE reconnect must not strand the browser on a rotated refresh token | High | code-review, security-review | None |
| [03](issues/03-percent-encoded-paths-must-not-bypass-csrf.md) | Percent-encoded paths must not bypass CSRF checks or the /l/ rate limit | High | security-review | None |
| [04](issues/04-double-submitted-remove-or-delete-task-must.md) | Double-submitted Remove or Delete Task must be idempotent | Medium | code-review | None |
| [05](issues/05-magic-links-must-not-be-logged-outside.md) | Magic links must not be logged outside local development | Medium | security-review, code-smells | None |
| [06](issues/06-make-rate-limiting-sound-behind-a-proxy.md) | Make rate limiting sound behind a proxy and bounded in memory | Medium | security-review, code-review | None |
| [07](issues/07-hash-passwords-asynchronously-and-make-password-login.md) | Hash passwords asynchronously and make password login uniform | Medium | security-review, code-review | None |
| [08](issues/08-send-security-headers-on-owner-and-assignee.md) | Send security headers on Owner and Assignee pages | Medium | security-review | None |
| [09](issues/09-tie-sse-streams-to-connection-and-session.md) | Tie SSE streams to connection and session lifetime | Medium | code-review, security-review | None |
| [10](issues/10-edit-task-must-be-able-to-clear.md) | Edit Task must be able to clear a Deadline | Medium | code-review, ui-ux-review, security-review | None |
| [11](issues/11-status-changes-need-a-precondition-and-cleaner.md) | Status changes need a precondition and cleaner feed values | Low | code-review | None |
| [12](issues/12-notes-near-the-2000-character-limit-must.md) | Notes near the 2000-character limit must not block status changes | Low | code-review | None |
| [13](issues/13-person-cleanup-in-assignlist-must-not-delete.md) | Person cleanup in assignList must not delete a Person another request attached | Low | code-review | None |
| [14](issues/14-require-re-authentication-to-set-or-change.md) | Require re-authentication to set or change a password | Low | security-review | None |
| [15](issues/15-tighten-login-email-validation-and-magic-link.md) | Tighten login email validation and magic-link token hygiene | Low | security-review | None |
| [16](issues/16-harden-session-cookies-and-the-csrf-token.md) | Harden session cookies and the CSRF token | Low | security-review, code-review | 03 |
| [17](issues/17-add-per-owner-quotas-pagination-and-event.md) | Add per-Owner quotas, pagination and event retention | Low | security-review, code-smells | None |
| [18](issues/18-harden-no-login-local-mode.md) | Harden no-login (local) mode | Low | security-review | None |
| [19](issues/19-small-input-handling-hardening-backpath-form-parser.md) | Small input-handling hardening: backPath, form parser, feed read marker | Low | security-review | None |
| [20](issues/20-fix-sse-replay-window-and-revoke-targeting.md) | Fix SSE replay window and revoke targeting | Low | code-review | None |
| [21](issues/21-correct-small-ordering-and-event-fidelity-issues.md) | Correct small ordering and event-fidelity issues in List and Task writes | Low | code-review | None |
| [22](issues/22-close-remaining-test-gaps-from-the-code.md) | Close remaining test gaps from the code review | Low | code-review | None |
| [23](issues/23-repository-and-configuration-hygiene-info-items.md) | Repository and configuration hygiene (Info items) | Info | security-review, code-smells | None |
| [24](issues/24-extract-limits-cookie-names-statuses-and-event.md) | Extract limits, cookie names, statuses and event kinds; delete dead code | Low | code-smells | 01, 04 |
| [25](issues/25-de-duplicate-request-plumbing-in-the-workflow.md) | De-duplicate request plumbing in the workflow routes | Low | code-smells | 24 |
| [26](issues/26-extract-domain-operations-out-of-workflow-ts.md) | Extract domain operations out of workflow.ts | Low | code-smells | 25 |
| [27](issues/27-owner-scoped-repository-so-tenant-scoping-is.md) | Owner-scoped repository so tenant scoping is not hand-written | Low | code-smells | 26 |
| [28](issues/28-split-registerworkflow-into-route-modules.md) | Split registerWorkflow into route modules | Low | code-smells | 26, 03 |
| [29](issues/29-uniform-error-model-and-discriminated-catches.md) | Uniform error model and discriminated catches | Low | code-smells | 26 |
| [30](issues/30-render-pages-through-ejs-partials-with-one.md) | Render pages through EJS partials with one render path | Low | code-smells | 28 |
| [31](issues/31-move-inline-scripts-into-real-js-files.md) | Move inline scripts into real JS files | Low | code-smells, security-review | 28 |
| [32](issues/32-emit-the-csrf-token-explicitly-instead-of.md) | Emit the CSRF token explicitly instead of regex-injecting it | Low | code-smells | 30, 03, 16 |
| [33](issues/33-adopt-a-strict-content-security-policy.md) | Adopt a strict Content-Security-Policy | Medium | security-review | 08, 31 |
| [34](issues/34-move-the-blockedreason-migration-and-index-creation.md) | Move the blockedReason migration and index creation out of openAssignStore | Low | code-smells, code-review | 12 |
| [35](issues/35-split-workflow-test-ts-into-per-feature.md) | Split workflow.test.ts into per-feature files with shared helpers | Low | code-smells | 30 |
| [36](issues/36-low-priority-smell-clean-ups.md) | Low-priority smell clean-ups | Low | code-smells | 28 |
| [37](issues/37-status-buttons-keep-the-user-s-place.md) | Status buttons keep the user's place and confirm the change | High | ui-ux-review | 11 |
| [38](issues/38-task-rows-named-buttons-link-outside-summary.md) | Task rows: named buttons, link outside summary, stable expand | High | ui-ux-review | None |
| [39](issues/39-selection-and-list-dialogs-guidance-and-empty.md) | Selection and List dialogs: guidance and empty states | High | ui-ux-review | None |
| [40](issues/40-one-note-control-per-task-and-visible.md) | One Note control per Task and visible Assignee status | Medium | ui-ux-review | 38 |
| [41](issues/41-validation-errors-keep-the-form-and-name.md) | Validation errors keep the form and name the problem | Medium | ui-ux-review | 30 |
| [42](issues/42-live-updates-and-dialogs-must-not-discard.md) | Live updates and dialogs must not discard the user's work | Medium | ui-ux-review | 31 |
| [43](issues/43-fix-contrast-and-colour-consistency.md) | Fix contrast and colour consistency | Medium | ui-ux-review | None |
| [44](issues/44-assignee-page-messages-time-format-and-removed.md) | Assignee page messages, time format and Removed rows | Low | ui-ux-review | None |
| [45](issues/45-lists-sidebar-and-lists-page.md) | Lists sidebar and Lists page | Low | ui-ux-review | 39 |
| [46](issues/46-settings-layout-and-theme-css-clean-up.md) | Settings layout and theme CSS clean-up | Low | ui-ux-review | 30 |
| [47](issues/47-confirm-dialogs-for-revoke-and-all-deletes.md) | Confirm dialogs for Revoke and all deletes | Low | ui-ux-review | 38 |
| [48](issues/48-feed-and-board-wording-filters-and-terms.md) | Feed and Board wording, filters and terms | Low | ui-ux-review | 24 |

## Suggested order

1. 01-03 first: confirmed High bugs and security (add-Tasks race, SSE cookie/session revoke, encoded-path CSRF bypass).
2. 04-10: Medium bugs and security (remove race, magic-link logging, rate limiting, argon2, headers, SSE lifecycle, Deadline clear).
3. 11-23: Low items and hygiene. These are independent and can be taken in any order, apart from the listed blockers.
4. 24-36: the refactoring chain from code-smells (constants, plumbing, domain extraction, then routes, errors, views, scripts, CSRF helper, tests). It is blocked behind 01 and 04 so the extraction carries the corrected race logic. Everything stays under `src/assign/`, so ADR 0006's module boundary (and `test/architecture.test.ts`) holds; each ticket says so.
5. 37-48: UX tickets grouped by screen or theme. 37, 38 and 39 are High per the UI review and are unblocked (37 waits only on 11 to avoid conflicting status edits); markup-heavy ones (40, 41, 47, 48) are sequenced after the row and view work to limit conflicts.
6. 33 (strict CSP, Medium) is sequenced late because it needs 31 (inline scripts moved out) and 08 (headers); the non-CSP headers ship early in 08.

## Merged

- Code F1 + F7 + F8 (first part) + the completion-sync bullet from F12 into 01 (same add Tasks write path).
- Code F3 + F11 + security F9 reuse-detection bullets into 02 (same refresh-rotation code).
- Security F5 split into 08 (headers, early) and 33 (CSP, after inline scripts go); security F11 referrer note folded into 08.
- Code F5 + security F6 into 09 (same SSE lifecycle bug).
- Code F4 + UI M9 + security F15 deadline bullet into 10.
- Code F10 migration notes also referenced by 34; code F8 second bullet folded into 04.
- Code smells findings 1/2 (long lines, inline HTML), 3 (inline scripts), 4/5/6, 8, 9, 14 and 16 mapped to the chain 24-36; findings 10, 11, 13, 15 and parts of 18 folded into 36.
- UI Low items grouped by screen (44-48); UI M13/M8/L16 title into 41; UI M3/M1/L9 into 40.
- Info items (untracked files, lockfiles, `.env.example`, `npm audit`, duplicate ADR number, test-name drift, WorkLog check) folded into the single hygiene ticket 23.

## Dropped or not ticketed, and why

- Security F10 (Assignee POST has no CSRF) and F11 (link-code handling): by design, the code is the bearer credential; only the limiter and view-row residuals are ticketed (03, 17).
- Code F12: Overdue computed at render time only (spec requires it) and stale Assignee posts returning HTTP 200 (matches spec story 63) are noted in 21 and not actioned.
- All "Checked and OK", "Things checked and found correct" and "What's good" sections: not findings.
- Code review test gaps: attached to the ticket that owns the behaviour; the remainder is 22.

## Unverified findings

Marked Possible or Likely in the reports and flagged inside their tickets: code F5, F6, F7, F8, F10, F11; security F6 (leak race not reproduced), F8 (timing, Medium confidence), F12, F13, F14. UI contrast ratios were computed from tokens and pages were not rendered; re-verify in a browser (43, UX tickets generally).
