# 18: Renumber the Voice Assistant ADR to 0007

**What to build:** PR #4 left two ADRs numbered 0006: `0006-task-assignment-as-separate-module-on-mongodb.md` (from `main`) and `0006-voice-assistant-on-livekit-with-local-models.md` (from the Voice branch). Rename the Voice Assistant one to `0007-voice-assistant-on-livekit-with-local-models.md`, because fewer files refer to it, and update those references.

**Blocked by:** none

**Status:** ready-for-agent

- [ ] `docs/adr/` has exactly one file for each number.
- [ ] The Voice Assistant references say ADR 0007: `README.md` (Voice page section) and `.scratch/voice-notes-bot/issues/15-voice-assistant-on-livekit.md`.
- [ ] The Task assignment references (`.scratch/task-assignment/spec.md`, `plan.md`) still say ADR 0006.
- [ ] `grep -rn "ADR 0006"` outside `node_modules` finds only Task assignment references.
