# 32: Emit the CSRF token explicitly instead of regex-injecting it

**What to build:** Templates render the CSRF input with an explicit helper (`<%- csrf() %>`) and CSRF logic lives in its own module; the `onSend` regex that rewrites `<form ... method="post">` is removed, so single-quoted or unquoted `method=post` forms are not silently unprotected.

**Blocked by:** 30, 03, 16

**Status:** needs-triage

**Severity:** Low

**Source:** [code-smells](../../task-assignment-refresh/reviews/code-smells.md) Finding 16 `index.ts` CSRF regex injection (brittle) and move to `csrf.ts`

**Acceptance criteria:**

- [ ] Every POST form includes the token via the helper.
- [ ] A POST without the token is still rejected.
- [ ] The onSend HTML rewriting is deleted.
