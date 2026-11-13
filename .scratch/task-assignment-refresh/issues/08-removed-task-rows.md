# 08: Removed Task rows

**What to build:** When a Task is taken out of an assigned List, or deleted (Done or not), the Assignee's page keeps a row for it in a "Removed" section: title (copied at removal time), "Removed" label and date, with no buttons or Note. An open page gets a live banner "Task removed: <title>". Removals from a Draft List leave no record. Re-adding the Task clears its row and it returns as an Additional Task. Removed rows don't count in progress, and a List left with only Done Tasks still counts as completed. Removals appear on the Board feed. Spec stories 50–59.

**Blocked by:** 05, 06

**Status:** ready-for-agent

- [ ] A deleted Task still shows its title as Removed on the Assignee's page.
- [ ] Done and not-Done removals both show; Draft List removals show nothing.
- [ ] Re-adding clears the Removed row and applies the Additional Task tag.
- [ ] Progress excludes Removed rows; an all-Done remainder is completed.
- [ ] Live banner and feed entry on removal.
- [ ] Covered by tests through the existing HTTP workflow test seam.
