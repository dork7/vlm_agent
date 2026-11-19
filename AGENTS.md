## Agent skills

### Issue tracker

Issues are tracked as local markdown files under `.scratch/<feature>/` (for now; GitHub later). See `docs/agents/issue-tracker.md`.

### Triage labels

Uses the default triage labels, recorded as a `Status:` line in each issue file: needs-triage, needs-info, ready-for-agent, ready-for-human, wontfix. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `GLOSSARY.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.



**Task delegation**

You can also talk to codex, and launch codex agent with instructions to do a specific task if required. Tell codex the you can communicate with you using a chat file.   
chat file should be inside a folder with /comms and history should be maintained session wise with a description of task inside it at top so that any agent can refer to in case if required in future



**WorkLog**

For every new feature added or done create a log history file to maintain logs.

