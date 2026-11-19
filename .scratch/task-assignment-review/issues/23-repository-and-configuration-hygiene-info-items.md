# 23: Repository and configuration hygiene (Info items)

**What to build:** Fold of small Info items: make sure untracked `encrypted(3).fhc`, `.run-local.mts`, `.DS_Store`, `skills-lock.json` and the second lockfile (`yarn.lock` beside `package-lock.json`) are ignored or removed and never committed; pick one lockfile; add a note to `.env.example` that `ASSIGN_JWT_SECRET` should come from `openssl rand -base64 48` and that `LIVEKIT_*` and `ADMIN_PASSWORD` defaults must not reach production; run `npm audit --omit=dev` in CI (the review did not run it); renumber the duplicate ADR 0006 files; rename the test "requires a blocked reason" to use the Note term; confirm `task-assignment-refresh` has the WorkLog AGENTS.md requires (review marked this out of scope).

**Blocked by:** None

**Status:** needs-triage

**Severity:** Info

**Source:** [security-review](../../task-assignment-refresh/reviews/security-review.md) F15 repository hygiene, `.env.example` defaults, dependencies; [code-smells](../../task-assignment-refresh/reviews/code-smells.md) Finding 18 docs and standards observations; Finding 13 test-name drift

**Acceptance criteria:**

- [ ] `git status` shows none of the listed untracked files as candidates for commit.
- [ ] A single lockfile remains.
- [ ] `.env.example` carries the secret-generation and production-default warnings.
- [ ] CI runs `npm audit --omit=dev`.
- [ ] The two ADR files no longer share a number and references are updated.
- [ ] Test names use GLOSSARY terms.
