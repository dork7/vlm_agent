# 48: Feed and Board wording, filters and terms

**What to build:** Every event kind has a readable feed sentence (for example "Marked <Task> Blocked (<Note>)", using the stored `summary` where present). One verb is used for link views ("Opened"). "Unassigned Tasks" and "Draft Lists" are either added to GLOSSARY.md or replaced with defined terms. The Board tag filter is lower-cased and tags link to `?tag=`.

**Blocked by:** 24

**Status:** needs-triage

**Severity:** Low

**Source:** [ui-ux-review](../../task-assignment-refresh/reviews/ui-ux-review.md) L3 Feed falls back to raw kinds; [ui-ux-review](../../task-assignment-refresh/reviews/ui-ux-review.md) L10 Wording drift and non-glossary terms; [ui-ux-review](../../task-assignment-refresh/reviews/ui-ux-review.md) L11 Board tag filter is case sensitive; tags not links

**Acceptance criteria:**

- [ ] No feed row shows a raw event kind.
- [ ] `?tag=Kitchen` matches a `kitchen` tag.
- [ ] Terms match GLOSSARY.md.
- [ ] Covered by tests through the existing HTTP workflow test seam.
