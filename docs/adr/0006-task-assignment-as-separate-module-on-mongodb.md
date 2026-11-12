# Task assignment as a separate module on the same MongoDB

Task assignment (owners give Lists of Tasks to people by link) is built as its own module in `src/assign/`, sharing only the HTTP server and the MongoDB connection with the voice-notes bot. Its requirements sketched Postgres with Drizzle, "shared with the rest of vlm_agent", but the rest of vlm_agent is on MongoDB (ADR 0004), and a second database would mean a second service to run, back up and test against. Its tables become `ta_`-prefixed collections; tags are an array on the Task instead of join tables.

The one place the requirements asked for a transaction, counting a link's first view exactly once, is a single atomic `findOneAndUpdate` that only matches while `firstViewedAt` is null, so MongoDB doesn't need to run as a replica set.

The module never imports from the core, the Telegram adapter or the dashboard, and they never import from it, so it can be lifted out or switched off (it's off unless configured) without touching the bot.
