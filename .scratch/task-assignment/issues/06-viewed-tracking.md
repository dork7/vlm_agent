# 06: Viewed tracking

**What to build:** The link page posts a beacon to `/l/<code>/view`. It counts unless the user agent is a bot or link-preview crawler, the request is `HEAD`, or the owner's session cookie is valid. The first counted view sets `firstViewedAt` atomically and writes one "opened" event; every counted view updates `lastViewedAt` and `viewCount`. Every beacon is logged in `ta_views` with browser, device type and whether it counted, never the IP. A reassigned List starts with fresh view state. See spec story 17 and **One first view**, **Views**.

**Blocked by:** 05

**Status:** ready-for-agent

- [ ] Rendering `/l/<code>` counts nothing; the beacon does.
- [ ] Beacons from WhatsApp, TelegramBot, Slackbot, facebookexternalhit and other bots, or with the owner's cookie, are logged with `counted: false` and change nothing.
- [ ] Two simultaneous first beacons produce exactly one "opened" event and a view count of 2.
- [ ] `ta_views` records time, user agent, browser and device type, and no IP.
- [ ] A new Assignment after a reassign is "Not opened", and the old Assignment's views are kept.
