# 01: Dataset import and structured search

**What to build:** Create `src/agents/` with dataset import: read a CSV or JSON file from `dataset/`, detect fields, store rows in MongoDB tagged with a dataset id, and a field mapping (location, unit_type, price, images, payment). Add `searchListings(datasetId, filters)`: case-insensitive location match, unit type (1BHK/2BHK/studio with common spellings normalised), price range, limit. Re-import replaces rows. Spec stories 1–4.

**Blocked by:** none

**Status:** done

- [ ] CSV and JSON both import; malformed files give a clear error.
- [ ] Unit type spellings ("2 bed", "2BR", "two bedroom") normalise to one value.
- [ ] Search returns only rows from the requested Dataset.
- [ ] Missing image files are reported per row.
- [ ] Covered by tests with in-memory MongoDB.
