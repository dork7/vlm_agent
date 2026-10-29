# 04: Inventory Queries

**What to build:** A User asks about the Inventory ("how many blue mugs do we have?", "what's running low in Warehouse B?") and gets a plain-language answer. The app serves a dummy, read-only Inventory API from its own Fastify server: about 25 items (SKU, name, category, quantity, unit price, location) loaded from a seed file into memory, protected by an API key. Endpoints: list items with optional filters (name partial match, category, location, low stock below a fixed threshold) and get one item by SKU. The model now also chooses Query, and answers it using exactly two predefined tools, search items and get item, which make real HTTP requests to the configured Inventory base URL with the configured key (ADR 0002). The model never builds URLs. A request to change Inventory data (a Command) is politely declined.

**Blocked by:** 01

**Status:** ready-for-agent

- [ ] Through Seam 2: list items supports each filter and their combination; get item returns the item or 404; requests without the correct API key get 401.
- [ ] Through Seam 1 with the real Inventory routes on a random port: a Query calls a tool over HTTP and the result event contains a plain-language answer built from the returned items.
- [ ] A Query matching nothing produces a reply that clearly says nothing matched.
- [ ] A Command (e.g. "add 50 units of SKU-12") produces a polite "not supported yet" reply and no Inventory request that changes data.
- [ ] Each tool call's tool, endpoint, HTTP status and latency is captured for ticket 12.
- [ ] Inventory data is never stored in MongoDB.
