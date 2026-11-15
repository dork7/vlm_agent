import type { AssignConfig } from "./config.ts";
import type { AssignStore } from "./store.ts";
import type { Mailer } from "./mailer.ts";
import type { createRateLimiter } from "./rate-limit.ts";
export type AssignContext = { config: AssignConfig; store: AssignStore; mailer: Mailer; now: () => Date; limiter: ReturnType<typeof createRateLimiter> };
