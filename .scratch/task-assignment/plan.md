# Task Assignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Task assignment module: owners log in by email, define Tasks, group them into Lists, assign a List to a Person by link, and watch progress live on a Board, without touching the voice-notes bot.

**Architecture:** One self-contained Fastify plugin in `src/assign/`, registered on the existing server only when configured. It owns `ta_`-prefixed MongoDB collections on the bot's existing database, renders EJS pages with small inline scripts, and pushes changes over Server-Sent Events from an in-process hub. Owner routes live under `/assign`, assignee pages under `/l/<code>`.

**Tech Stack:** Node ≥ 24.7 (built-in `crypto.argon2`), TypeScript run by tsx, Fastify 5, EJS, MongoDB driver 7, Vitest with mongodb-memory-server. No new runtime packages.

**Spec:** `.scratch/task-assignment/spec.md` (requirements and TA-n IDs in `.scratch/task-assignment/requirements.md`; tickets in `.scratch/task-assignment/issues/`). Read both before starting.

## Global Constraints

- All module code in `src/assign/`, its tests in `test/assign/`. Never import from `src/core`, `src/telegram`, `src/dashboard`, `src/db.ts`; they never import from `src/assign`. Outside the module, only `src/server.ts`, `src/main.ts`, `test/architecture.test.ts`, `package.json` (engines) and `.env.example` change.
- The existing test suite must keep passing unchanged: `npm test`.
- The module is off unless `ASSIGN_JWT_SECRET` and `PUBLIC_URL` are set.
- Collections: `ta_owners`, `ta_login_tokens`, `ta_refresh_tokens`, `ta_tasks`, `ta_lists`, `ta_people`, `ta_assignments`, `ta_views`, `ta_events`, `ta_counters`. Every query on a workspace collection filters by `ownerId`.
- Limits: titles 200 characters; note, instruction, blocked reason 2,000; tags at most 5, each at most 30, trimmed and lowercased; 50 Tasks per List; link codes 10 characters from `[A-Za-z0-9]`.
- Times: stored as UTC `Date`s; pages render `<time datetime="ISO">` and the client script shows local, relative wording.
- Magic link 15 minutes, single use; access JWT 15 minutes (`ta_access`, path `/`); refresh token 30 days (`ta_refresh`, path `/assign`); CSRF cookie `ta_csrf` (path `/assign`). All cookies httpOnly, SameSite=Lax, Secure when `PUBLIC_URL` is https.
- Rate limits: login links 5 per 15 min per email and per IP; password tries 5 per 15 min per email; new accounts 5 per hour per IP; link pages 60 per minute per IP.
- Never log link codes or store IP addresses.
- Use the glossary terms from `GLOSSARY.md` → "Task assignment" in names, copy and tests: Owner, Task, List, Person, Assignee, Assignment, Board.
- Commit after each task with a message ending in `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Email link scanners** (Outlook Safe Links, Gmail) fetch the magic link before the Owner clicks it: a GET must never use up the token. Test in Task 1.
2. **Parallel requests just after the access token expires** (page, SSE stream and beacon all at once, each with the same refresh cookie) must not be mistaken for refresh-token theft and log the Owner out. Test in Task 2 (30-second grace).
3. **Link codes in the server log**: Fastify logs every request URL, which for `/l/<code>` would leak the only credential. Test in Task 5 with a captured log stream.
4. **A guessed or stale Task ID on a link page**: an Assignee posting a status for a Task removed from the List, or in another List, must be refused. Test in Task 5.
5. **Double-clicking Assign** must not leave two live links for one List: a unique partial index on active Assignments. Test in Task 5.

---

## File map

| File | Responsibility | Task |
| --- | --- | --- |
| `src/assign/config.ts` | Read the module's env vars; `null` when off | 1 |
| `src/assign/store.ts` | Document types, collections, indexes | 1 |
| `src/assign/crypto.ts` | Random tokens and codes, SHA-256, HS256 JWT, argon2id | 1, 2, 5 |
| `src/assign/rate-limit.ts` | In-memory sliding-window limiter | 1 |
| `src/assign/mailer.ts` | `Mailer` with Resend and console implementations | 1 |
| `src/assign/http.ts` | Forms, cookies, rendering, small reply helpers | 1 |
| `src/assign/context.ts` | `AssignContext` shared by all route files | 1 |
| `src/assign/auth.ts` | Login, magic link, sessions, passwords, CSRF, logout | 1, 2 |
| `src/assign/index.ts` | The plugin: builds the context, registers scopes | 1 |
| `src/assign/events.ts` | `recordEvent`, the in-process hub | 3 |
| `src/assign/tasks.ts` | Task pool routes and shared status change | 3 |
| `src/assign/lists.ts` | List routes | 4 |
| `src/assign/assignments.ts` | Assign, reassign, revoke | 5 |
| `src/assign/link.ts` | Assignee link page, its actions and the view beacon | 5, 6 |
| `src/assign/user-agent.ts` | Bot detection, browser and device type | 6 |
| `src/assign/board.ts` | Board and activity feed | 7 |
| `src/assign/sse.ts` | SSE streams with replay | 8 |
| `src/assign/people.ts`, `src/assign/housekeeping.ts` | Deleting People; the daily purge | 9 |
| `src/assign/views/*.ejs` | Pages | all |
| `test/assign/harness.ts`, `test/assign/sse-client.ts` | Test app, cookie-jar agent, SSE reader | 1, 8 |

---

### Task 1: Module setup and magic-link login (ticket 01)

**Files:**
- Modify: `package.json` (engines), `.env.example`, `src/server.ts`, `src/main.ts`, `test/architecture.test.ts`
- Create: `src/assign/{config,store,crypto,rate-limit,mailer,http,context,auth,index}.ts`, `src/assign/views/{header,footer,live,login,login-sent,confirm-login,board}.ejs`
- Test: `test/assign/harness.ts`, `test/assign/login.test.ts`, `test/assign/config.test.ts`

**Interfaces:**
- Produces:
  - `loadAssignConfig(env): AssignConfig | null`, `class AssignConfigError`
  - `openAssignStore(db: Db): Promise<AssignStore>` and the doc types `OwnerDoc`, `TaskDoc`, `ListDoc`, `PersonDoc`, `AssignmentDoc`, `ViewDoc`, `EventDoc`, `EventKind`, `TaskStatus`
  - `randomToken(bytes?)`, `sha256(text)`, `signJwt(payload, secret)`, `verifyJwt(token, secret, now)`
  - `createRateLimiter(now): RateLimiter` with `allow(key, limit, windowMs): boolean`
  - `Mailer`, `resendMailer`, `consoleMailer`
  - `field`, `fields`, `parseForm`, `parseCookies`, `setCookie`, `clearCookie`, `render`, `parseId`, `Form`
  - `AssignContext`
  - `assignRoutes: FastifyPluginAsync<AssignOptions>`, `AssignOptions = { db; config; mailer; now? }`
  - `startSession(ctx, reply, owner)`, `requireOwner(ctx)`, `currentOwner(ctx, request, reply)`
  - Harness: `useAssignApp()` returning `{ app, store, mail, clock, agent(ip?), logIn(email, agent?) }`

- [ ] **Step 1: Write the harness**

`test/assign/harness.ts`:

```ts
import { randomUUID } from "node:crypto";
import type { Writable } from "node:stream";
import Fastify, { type FastifyInstance } from "fastify";
import type { Response as InjectResponse } from "light-my-request";
import { MongoClient } from "mongodb";
import { MongoMemoryServer } from "mongodb-memory-server";
import { afterAll, afterEach, beforeAll, beforeEach } from "vitest";
import type { AssignConfig } from "../../src/assign/config.ts";
import { assignRoutes } from "../../src/assign/index.ts";
import type { Mail } from "../../src/assign/mailer.ts";
import { openAssignStore, type AssignStore } from "../../src/assign/store.ts";

export const START = new Date("2026-11-12T09:00:00Z");

export const TEST_CONFIG: AssignConfig = {
  publicUrl: "http://assign.test",
  jwtSecret: "test-secret-that-is-at-least-32-characters-long",
  signupMode: "open",
  allowedEmails: [],
  resend: undefined,
  viewRetentionDays: 90,
  secureCookies: false,
  trustProxy: false,
};

export type Agent = {
  cookies: Map<string, string>;
  cookieHeader(): string;
  get(url: string, headers?: Record<string, string>): Promise<InjectResponse>;
  post(url: string, form?: Record<string, string | string[]>, headers?: Record<string, string>): Promise<InjectResponse>;
};

/** A fresh Task assignment app per test, on its own database, with a fake mailer and a clock the test moves. */
export function useAssignApp(options: { config?: Partial<AssignConfig>; logStream?: Writable } = {}) {
  let mongo: MongoMemoryServer;
  let client: MongoClient;
  let app: FastifyInstance;
  let store: AssignStore;
  const mail: Mail[] = [];
  const clock = {
    now: new Date(START),
    advance(ms: number) {
      clock.now = new Date(clock.now.getTime() + ms);
    },
  };

  beforeAll(async () => {
    mongo = await MongoMemoryServer.create();
    client = await MongoClient.connect(mongo.getUri());
  });
  beforeEach(async () => {
    const db = client.db(`assign_${randomUUID().slice(0, 8)}`);
    mail.length = 0;
    clock.now = new Date(START);
    app = Fastify({ logger: options.logStream ? { level: "info", stream: options.logStream } : false });
    await app.register(assignRoutes, {
      db,
      config: { ...TEST_CONFIG, ...options.config },
      mailer: { send: async (message) => void mail.push(message) },
      now: () => clock.now,
    });
    await app.ready();
    store = await openAssignStore(db);
  });
  afterEach(async () => {
    await app.close();
  });
  afterAll(async () => {
    await client?.close();
    await mongo?.stop();
  });

  /** A browser: keeps cookies, and adds the CSRF token to every form it posts. */
  const agent = (ip = "203.0.113.1"): Agent => {
    const cookies = new Map<string, string>();
    const remember = (response: InjectResponse) => {
      for (const header of [response.headers["set-cookie"] ?? []].flat()) {
        const [pair] = header.split(";");
        const at = pair!.indexOf("=");
        const name = pair!.slice(0, at);
        const value = pair!.slice(at + 1);
        if (/max-age=0/i.test(header)) cookies.delete(name);
        else cookies.set(name, value);
      }
    };
    const cookieHeader = () => [...cookies].map(([name, value]) => `${name}=${value}`).join("; ");
    const get = async (url: string, headers: Record<string, string> = {}) => {
      const response = await app.inject({ method: "GET", url, remoteAddress: ip, headers: { cookie: cookieHeader(), ...headers } });
      remember(response);
      return response;
    };
    return {
      cookies,
      cookieHeader,
      get,
      /** Like a browser that loaded a page first: fetches a CSRF cookie when it has none, unless the test sets `_csrf`. */
      async post(url, form = {}, headers = {}) {
        if (url.startsWith("/assign") && !cookies.has("ta_csrf") && !("_csrf" in form)) await get("/assign/login");
        const body = new URLSearchParams();
        for (const [name, value] of Object.entries(form)) for (const one of [value].flat()) body.append(name, one);
        if (cookies.has("ta_csrf") && !("_csrf" in form)) body.append("_csrf", cookies.get("ta_csrf")!);
        const response = await app.inject({
          method: "POST",
          url,
          remoteAddress: ip,
          payload: body.toString(),
          headers: { "content-type": "application/x-www-form-urlencoded", cookie: cookieHeader(), ...headers },
        });
        remember(response);
        return response;
      },
    };
  };

  /** The path and query of the last email's link. */
  const lastLink = () => {
    const url = mail.at(-1)?.text.match(/https?:\/\/\S+/)?.[0];
    if (!url) throw new Error("No link was emailed");
    const { pathname, search } = new URL(url);
    return pathname + search;
  };

  /** Logs `email` in through the magic link, as a browser would, and returns that browser. */
  const logIn = async (email: string, browser = agent()) => {
    await browser.get("/assign/login");
    await browser.post("/assign/login", { email });
    const link = lastLink();
    const token = new URL(link, "http://x").searchParams.get("token")!;
    await browser.get(link);
    const done = await browser.post("/assign/auth", { token });
    if (done.statusCode !== 303) throw new Error(`Login failed: ${done.statusCode} ${done.body}`);
    return browser;
  };

  return { app: () => app, store: () => store, mail, clock, agent, logIn, lastLink };
}

/** A page without its per-browser values (CSRF token, form values), to compare two replies. */
export function strip(html: string): string {
  return html.replace(/(value|content)="[^"]*"/g, "");
}
```

- [ ] **Step 2: Write the failing login tests**

`test/assign/login.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { strip, useAssignApp } from "./harness.ts";

describe("Task assignment: magic-link login", () => {
  const t = useAssignApp();

  it("emails a one-time link that logs a new Owner in and lands on the Board", async () => {
    const browser = t.agent();
    await browser.get("/assign/login");
    const sent = await browser.post("/assign/login", { email: " Sara@Example.com " });

    expect(sent.statusCode).toBe(200);
    expect(sent.body).toContain("Check your email");
    expect(t.mail).toHaveLength(1);
    expect(t.mail[0]!.to).toBe("sara@example.com");
    const link = t.lastLink();
    expect(link).toMatch(/^\/assign\/auth\?token=[A-Za-z0-9_-]{43}$/);

    const token = new URL(link, "http://x").searchParams.get("token")!;
    const stored = await t.store().loginTokens.findOne({});
    expect(stored!.tokenHash).not.toContain(token);

    const loggedIn = await browser.post("/assign/auth", { token });
    expect(loggedIn.statusCode).toBe(303);
    const board = await browser.get("/assign");
    expect(board.statusCode).toBe(200);
    expect(board.body).toContain("Board");
    expect(await t.store().owners.countDocuments({ email: "sara@example.com" })).toBe(1);
  });

  it("shows a confirm button on GET, so email scanners opening the link don't use it up", async () => {
    const browser = t.agent();
    await browser.get("/assign/login");
    await browser.post("/assign/login", { email: "sara@example.com" });
    const link = t.lastLink();

    // A scanner opens it twice first.
    await t.agent("198.51.100.9").get(link);
    const page = await t.agent("198.51.100.9").get(link);
    expect(page.body).toContain("Log in");

    const token = new URL(link, "http://x").searchParams.get("token")!;
    expect((await browser.post("/assign/auth", { token })).statusCode).toBe(303);
  });

  it("refuses a link used twice or after 15 minutes", async () => {
    await t.logIn("sara@example.com");
    const used = new URL(t.lastLink(), "http://x").searchParams.get("token")!;
    const again = await t.agent().post("/assign/auth", { token: used });
    expect(again.statusCode).toBe(400);
    expect(again.body).toContain("expired or was already used");

    const browser = t.agent();
    await browser.get("/assign/login");
    await browser.post("/assign/login", { email: "sara@example.com" });
    const late = new URL(t.lastLink(), "http://x").searchParams.get("token")!;
    t.clock.advance(15 * 60_000 + 1);
    expect((await browser.post("/assign/auth", { token: late })).statusCode).toBe(400);
  });

  it("gives the same reply whether or not an email may sign in", async () => {
    await t.logIn("owner@example.com");
    const known = await t.agent().post("/assign/login", { email: "owner@example.com" });
    const unknown = await t.agent().post("/assign/login", { email: "nobody@example.com" });
    expect(known.statusCode).toBe(unknown.statusCode);
    expect(strip(known.body)).toBe(strip(unknown.body));
  });

  it("sends at most 5 links per 15 minutes per email and per IP, with the same reply", async () => {
    for (let i = 0; i < 7; i++) await t.agent(`192.0.2.${i}`).post("/assign/login", { email: "sara@example.com" });
    expect(t.mail).toHaveLength(5);

    t.mail.length = 0;
    const one = t.agent("192.0.2.200");
    for (let i = 0; i < 7; i++) await one.post("/assign/login", { email: `person${i}@example.com` });
    expect(t.mail).toHaveLength(5);

    t.clock.advance(15 * 60_000 + 1);
    await one.post("/assign/login", { email: "late@example.com" });
    expect(t.mail).toHaveLength(6);
  });

  it("refuses a malformed email with a message", async () => {
    const reply = await t.agent().post("/assign/login", { email: "not-an-email" });
    expect(reply.statusCode).toBe(400);
    expect(reply.body).toContain("Enter a valid email");
    expect(t.mail).toHaveLength(0);
  });

  it("sends Owners without a session to the login page", async () => {
    const reply = await t.agent().get("/assign");
    expect(reply.statusCode).toBe(302);
    expect(reply.headers.location).toBe("/assign/login");
  });

  it("caps new accounts at 5 per hour per IP", async () => {
    for (let i = 0; i < 5; i++) await t.logIn(`new${i}@example.com`, t.agent("192.0.2.50"));
    // Asked for from another network (link requests have their own per-IP limit), opened from the same one.
    await t.agent("192.0.2.51").post("/assign/login", { email: "sixth@example.com" });
    const token = new URL(t.lastLink(), "http://x").searchParams.get("token")!;
    const refused = await t.agent("192.0.2.50").post("/assign/auth", { token });
    expect(refused.statusCode).toBe(429);
    expect(await t.store().owners.countDocuments()).toBe(5);
  });
});

describe("Task assignment: allowlist sign-up", () => {
  const t = useAssignApp({ config: { signupMode: "allowlist", allowedEmails: ["sara@example.com"] } });

  it("sends a link only to allowed emails, with the same reply for others", async () => {
    const allowed = await t.agent().post("/assign/login", { email: "sara@example.com" });
    const other = await t.agent().post("/assign/login", { email: "eve@example.com" });
    expect(t.mail.map((message) => message.to)).toEqual(["sara@example.com"]);
    expect(strip(other.body)).toBe(strip(allowed.body));
  });
});
```

`test/assign/config.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { AssignConfigError, loadAssignConfig } from "../../src/assign/config.ts";
import { consoleMailer, resendMailer } from "../../src/assign/mailer.ts";

const ON = { ASSIGN_JWT_SECRET: "x".repeat(32), PUBLIC_URL: "https://tasks.example.com/" };

describe("Task assignment: configuration", () => {
  it("is off without its secret and public URL", () => {
    expect(loadAssignConfig({})).toBeNull();
    expect(loadAssignConfig({ PUBLIC_URL: "https://x.example" })).toBeNull();
  });

  it("reads its settings, with secure cookies for https", () => {
    expect(loadAssignConfig({ ...ON, SIGNUP_MODE: "allowlist", ASSIGN_ALLOWED_EMAILS: " A@x.com, b@y.com ", RESEND_API_KEY: "re_1", MAIL_FROM: "Tasks <t@x.com>" })).toEqual({
      publicUrl: "https://tasks.example.com",
      jwtSecret: "x".repeat(32),
      signupMode: "allowlist",
      allowedEmails: ["a@x.com", "b@y.com"],
      resend: { apiKey: "re_1", from: "Tasks <t@x.com>" },
      viewRetentionDays: 90,
      secureCookies: true,
      trustProxy: false,
    });
  });

  it("refuses a short secret, a bad sign-up mode and a Resend key without a sender", () => {
    expect(() => loadAssignConfig({ ...ON, ASSIGN_JWT_SECRET: "short" })).toThrow(AssignConfigError);
    expect(() => loadAssignConfig({ ...ON, SIGNUP_MODE: "closed" })).toThrow(AssignConfigError);
    expect(() => loadAssignConfig({ ...ON, RESEND_API_KEY: "re_1" })).toThrow(/MAIL_FROM/);
  });
});

describe("Task assignment: mailers", () => {
  it("sends through Resend's API with the key and sender", async () => {
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 200 }));
    await resendMailer({ apiKey: "re_1", from: "t@x.com" }, fetchImpl).send({ to: "a@x.com", subject: "S", text: "T" });
    expect(fetchImpl).toHaveBeenCalledWith("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: "Bearer re_1", "content-type": "application/json" },
      body: JSON.stringify({ from: "t@x.com", to: ["a@x.com"], subject: "S", text: "T" }),
    });
  });

  it("throws when Resend refuses", async () => {
    const fetchImpl = async () => new Response("bad", { status: 422 });
    await expect(resendMailer({ apiKey: "k", from: "f" }, fetchImpl).send({ to: "a", subject: "s", text: "t" })).rejects.toThrow(/422/);
  });

  it("logs the email when no provider is configured", async () => {
    const log = vi.fn();
    await consoleMailer(log).send({ to: "a@x.com", subject: "Log in", text: "http://link" });
    expect(log).toHaveBeenCalledWith(expect.stringContaining("http://link"));
  });
});
```

Add to `test/architecture.test.ts`, after the existing `describe`:

```ts
describe("Task assignment module (ADR 0006)", () => {
  it("never depends on the bot's core, Telegram adapter, dashboard or database module", () => {
    const imports = reachableImports("src/assign/index.ts");

    expect(imports.length).toBeGreaterThan(0);
    expect(imports.filter((specifier) => /\/(core|telegram|dashboard)\/|\/db\.ts$|grammy/.test(specifier))).toEqual([]);
  });

  it("is never imported by the bot's core, Telegram adapter or dashboard", () => {
    for (const entry of ["src/core/core.ts", "src/telegram/adapter.ts", "src/dashboard/dashboard.ts"]) {
      expect(reachableImports(entry).filter((specifier) => specifier.includes("assign/"))).toEqual([]);
    }
  });
});
```

- [ ] **Step 3: Run the tests and see them fail**

Run: `npx vitest run test/assign test/architecture.test.ts`
Expected: FAIL. The imports of `src/assign/...` can't be resolved.

- [ ] **Step 4: Bump the Node floor and document the settings**

In `package.json`, set `"engines": { "node": ">=24.7" }` (built-in `crypto.argon2`, used in Task 2).

Append to `.env.example`:

```
# Task assignment (ADR 0006): off unless both of these are set.
# A random secret of at least 32 characters, e.g. `openssl rand -base64 48`.
ASSIGN_JWT_SECRET=
# The address people open, used in login emails and assignee links, e.g. https://tasks.example.com
PUBLIC_URL=
# "open" (anyone may sign up) or "allowlist" (only ASSIGN_ALLOWED_EMAILS, comma-separated).
SIGNUP_MODE=
ASSIGN_ALLOWED_EMAILS=
# Login emails go through Resend when set; otherwise the link is printed in the server log.
RESEND_API_KEY=
MAIL_FROM=
# Days to keep the log of link opens (default 90).
ASSIGN_VIEW_RETENTION_DAYS=
# "true" behind a reverse proxy (Caddy, nginx), so rate limits see the visitor's IP.
TRUST_PROXY=
```

- [ ] **Step 5: Write `src/assign/config.ts`**

```ts
export type AssignConfig = {
  /** Where people reach the app, without a trailing slash; used in emailed and copied links. */
  publicUrl: string;
  jwtSecret: string;
  signupMode: "open" | "allowlist";
  /** Lowercased; who may create an account when `signupMode` is "allowlist". */
  allowedEmails: string[];
  /** Absent: login emails are printed to the console. */
  resend: { apiKey: string; from: string } | undefined;
  viewRetentionDays: number;
  /** True when `publicUrl` is https, so cookies are marked Secure. */
  secureCookies: boolean;
  /** Behind a reverse proxy, so `request.ip` is the visitor's. */
  trustProxy: boolean;
};

export class AssignConfigError extends Error {}

/** The Task assignment module's settings, or null when it is switched off. */
export function loadAssignConfig(env: Record<string, string | undefined>): AssignConfig | null {
  const value = (name: string) => env[name]?.trim() || undefined;
  const jwtSecret = value("ASSIGN_JWT_SECRET");
  const publicUrl = value("PUBLIC_URL");
  if (!jwtSecret || !publicUrl) return null;

  if (jwtSecret.length < 32) throw new AssignConfigError("ASSIGN_JWT_SECRET must be at least 32 characters");
  let url;
  try {
    url = new URL(publicUrl);
    if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error();
  } catch {
    throw new AssignConfigError(`PUBLIC_URL must be an http:// or https:// URL, got "${publicUrl}"`);
  }
  const signupMode = value("SIGNUP_MODE") ?? "open";
  if (signupMode !== "open" && signupMode !== "allowlist") {
    throw new AssignConfigError(`SIGNUP_MODE must be "open" or "allowlist", got "${signupMode}"`);
  }
  const apiKey = value("RESEND_API_KEY");
  const from = value("MAIL_FROM");
  if (apiKey && !from) throw new AssignConfigError("RESEND_API_KEY also needs MAIL_FROM, the sender address");
  const viewRetentionDays = Number(value("ASSIGN_VIEW_RETENTION_DAYS") ?? 90);
  if (!Number.isInteger(viewRetentionDays) || viewRetentionDays <= 0) {
    throw new AssignConfigError("ASSIGN_VIEW_RETENTION_DAYS must be a positive whole number");
  }

  return {
    publicUrl: publicUrl.replace(/\/+$/, ""),
    jwtSecret,
    signupMode,
    allowedEmails: (value("ASSIGN_ALLOWED_EMAILS") ?? "")
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
    resend: apiKey ? { apiKey, from: from! } : undefined,
    viewRetentionDays,
    secureCookies: url.protocol === "https:",
    trustProxy: value("TRUST_PROXY") === "true",
  };
}
```

- [ ] **Step 6: Write `src/assign/store.ts`**

```ts
import type { Collection, Db, ObjectId } from "mongodb";

export type TaskStatus = "open" | "blocked" | "done";

export type OwnerDoc = {
  _id?: ObjectId;
  email: string;
  passwordHash: string | null;
  /** Whether the "Set a password?" page has been offered once. */
  passwordOffered: boolean;
  /** Bumped by "sign out everywhere" and password changes; access tokens carry it and stop working with a change. */
  sessionVersion: number;
  /** The newest event `seq` the Owner has seen in the feed; newer ones are unread. */
  lastSeenEventSeq: number;
  createdAt: Date;
};

export type LoginTokenDoc = { _id?: ObjectId; email: string; tokenHash: string; expiresAt: Date; usedAt: Date | null };

export type RefreshTokenDoc = {
  _id?: ObjectId;
  ownerId: ObjectId;
  /** Shared by every token rotated from one login, so reuse of an old one can revoke them all. */
  family: string;
  tokenHash: string;
  expiresAt: Date;
  revokedAt: Date | null;
  replacedBy: ObjectId | null;
};

export type TaskDoc = {
  _id?: ObjectId;
  ownerId: ObjectId;
  title: string;
  tags: string[];
  status: TaskStatus;
  instruction: string;
  note: string;
  blockedReason: string;
  listId: ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
};

export type ListDoc = { _id?: ObjectId; ownerId: ObjectId; name: string; status: "draft" | "active"; createdAt: Date };

export type PersonDoc = { _id?: ObjectId; ownerId: ObjectId; name: string; nameLower: string; createdAt: Date };

export type AssignmentDoc = {
  _id?: ObjectId;
  ownerId: ObjectId;
  listId: ObjectId;
  personId: ObjectId;
  code: string;
  /** True until revoked; at most one active Assignment per List (unique partial index). */
  active: boolean;
  createdAt: Date;
  revokedAt: Date | null;
  firstViewedAt: Date | null;
  lastViewedAt: Date | null;
  viewCount: number;
};

export type ViewDoc = {
  _id?: ObjectId;
  ownerId: ObjectId;
  assignmentId: ObjectId;
  viewedAt: Date;
  userAgent: string;
  browser: string;
  deviceType: "mobile" | "tablet" | "desktop";
  /** False for bots, link previews and the Owner's own visits. */
  counted: boolean;
  outcome: "ok";
};

export type EventKind =
  | "task-created"
  | "task-edited"
  | "task-status"
  | "task-note"
  | "task-deleted"
  | "list-created"
  | "list-changed"
  | "list-deleted"
  | "assigned"
  | "revoked"
  | "person-deleted"
  | "opened"
  | "list-complete";

export type EventDoc = {
  _id?: ObjectId;
  /** Increasing across the database; the SSE event ID. */
  seq: number;
  ownerId: ObjectId;
  kind: EventKind;
  actor: "owner" | "assignee";
  /** One line for the activity feed, e.g. `Sara marked "Pack books" done`. */
  summary: string;
  taskId: ObjectId | null;
  listId: ObjectId | null;
  personId: ObjectId | null;
  assignmentId: ObjectId | null;
  from: string | null;
  to: string | null;
  createdAt: Date;
};

export type AssignStore = {
  owners: Collection<OwnerDoc>;
  loginTokens: Collection<LoginTokenDoc>;
  refreshTokens: Collection<RefreshTokenDoc>;
  tasks: Collection<TaskDoc>;
  lists: Collection<ListDoc>;
  people: Collection<PersonDoc>;
  assignments: Collection<AssignmentDoc>;
  views: Collection<ViewDoc>;
  events: Collection<EventDoc>;
  counters: Collection<{ _id: string; seq: number }>;
};

/** The module's collections on the shared database, with their indexes. */
export async function openAssignStore(db: Db): Promise<AssignStore> {
  const store: AssignStore = {
    owners: db.collection("ta_owners"),
    loginTokens: db.collection("ta_login_tokens"),
    refreshTokens: db.collection("ta_refresh_tokens"),
    tasks: db.collection("ta_tasks"),
    lists: db.collection("ta_lists"),
    people: db.collection("ta_people"),
    assignments: db.collection("ta_assignments"),
    views: db.collection("ta_views"),
    events: db.collection("ta_events"),
    counters: db.collection("ta_counters"),
  };
  await Promise.all([
    store.owners.createIndex({ email: 1 }, { unique: true }),
    store.loginTokens.createIndex({ tokenHash: 1 }, { unique: true }),
    store.refreshTokens.createIndex({ tokenHash: 1 }, { unique: true }),
    store.refreshTokens.createIndex({ ownerId: 1, family: 1 }),
    store.tasks.createIndex({ ownerId: 1, listId: 1 }),
    store.lists.createIndex({ ownerId: 1 }),
    store.people.createIndex({ ownerId: 1, nameLower: 1 }, { unique: true }),
    store.assignments.createIndex({ code: 1 }, { unique: true }),
    store.assignments.createIndex({ listId: 1 }, { unique: true, partialFilterExpression: { active: true } }),
    store.assignments.createIndex({ ownerId: 1, personId: 1 }),
    store.views.createIndex({ assignmentId: 1 }),
    store.views.createIndex({ viewedAt: 1 }),
    store.events.createIndex({ seq: 1 }, { unique: true }),
    store.events.createIndex({ ownerId: 1, seq: -1 }),
  ]);
  return store;
}
```

- [ ] **Step 7: Write `src/assign/crypto.ts` (tokens, hashes and JWT)**

```ts
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/** A random URL-safe token; 32 bytes gives 43 characters. */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/** Compares two strings in constant time; false when their lengths differ. */
export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

const JWT_HEADER = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");

export function signJwt(payload: Record<string, unknown>, secret: string): string {
  const body = `${JWT_HEADER}.${Buffer.from(JSON.stringify(payload)).toString("base64url")}`;
  return `${body}.${createHmac("sha256", secret).update(body).digest("base64url")}`;
}

/** The payload of a well-signed, unexpired HS256 token, or null. `exp` is in seconds. */
export function verifyJwt(token: string | undefined, secret: string, now: Date): Record<string, unknown> | null {
  if (!token) return null;
  const [header, payload, signature] = token.split(".");
  if (header !== JWT_HEADER || !payload || !signature) return null;
  const expected = createHmac("sha256", secret).update(`${header}.${payload}`).digest("base64url");
  if (!safeEqual(signature, expected)) return null;
  try {
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (typeof claims.exp !== "number" || claims.exp * 1000 <= now.getTime()) return null;
    return claims;
  } catch {
    return null;
  }
}
```

- [ ] **Step 8: Write `src/assign/rate-limit.ts` and `src/assign/mailer.ts`**

```ts
// src/assign/rate-limit.ts
export type RateLimiter = {
  /** Records an attempt under `key`; false when `limit` attempts were already made in the last `windowMs`. */
  allow(key: string, limit: number, windowMs: number): boolean;
};

/** In-memory sliding windows: right for one server process (spec: Rate limits). */
export function createRateLimiter(now: () => Date): RateLimiter {
  const attempts = new Map<string, number[]>();
  return {
    allow(key, limit, windowMs) {
      const at = now().getTime();
      const recent = (attempts.get(key) ?? []).filter((time) => time > at - windowMs);
      if (recent.length >= limit) {
        attempts.set(key, recent);
        return false;
      }
      recent.push(at);
      attempts.set(key, recent);
      // Keep memory bounded: drop keys whose attempts are all older than a day.
      if (attempts.size > 10_000) {
        for (const [other, times] of attempts) if (times.every((time) => time < at - 86_400_000)) attempts.delete(other);
      }
      return true;
    },
  };
}
```

```ts
// src/assign/mailer.ts
export type Mail = { to: string; subject: string; text: string };
export type Mailer = { send(mail: Mail): Promise<void> };

/** Sends through Resend's HTTP API. */
export function resendMailer(settings: { apiKey: string; from: string }, fetchImpl: typeof fetch = fetch): Mailer {
  return {
    async send(mail) {
      const response = await fetchImpl("https://api.resend.com/emails", {
        method: "POST",
        headers: { authorization: `Bearer ${settings.apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({ from: settings.from, to: [mail.to], subject: mail.subject, text: mail.text }),
      });
      if (!response.ok) throw new Error(`Resend refused the email: ${response.status} ${await response.text()}`);
    },
  };
}

/** For development: prints the email, link included, instead of sending it. */
export function consoleMailer(log: (line: string) => void = console.log): Mailer {
  return {
    async send(mail) {
      log(`Email to ${mail.to}: ${mail.subject}\n${mail.text}`);
    },
  };
}
```

- [ ] **Step 9: Write `src/assign/http.ts` and `src/assign/context.ts`**

```ts
// src/assign/http.ts
import { fileURLToPath } from "node:url";
import ejs from "ejs";
import type { FastifyReply } from "fastify";
import { ObjectId } from "mongodb";

const VIEWS = fileURLToPath(new URL("./views/", import.meta.url));

/** A submitted form: a field posted more than once (checkboxes) is an array. */
export type Form = Record<string, string | string[]> | undefined;

export function parseForm(body: string): Record<string, string | string[]> {
  const form: Record<string, string | string[]> = {};
  for (const [name, value] of new URLSearchParams(body)) {
    const before = form[name];
    form[name] = before === undefined ? value : [before].flat().concat(value);
  }
  return form;
}

/** One field, trimmed; "" when absent. */
export function field(form: Form, name: string): string {
  const value = form?.[name];
  return (Array.isArray(value) ? (value[0] ?? "") : (value ?? "")).trim();
}

/** Every value of a repeated field, trimmed, empties dropped. */
export function fields(form: Form, name: string): string[] {
  const value = form?.[name];
  return value === undefined ? [] : [value].flat().map((one) => one.trim()).filter(Boolean);
}

export function parseId(id: string | undefined): ObjectId | null {
  return id && /^[0-9a-f]{24}$/.test(id) ? new ObjectId(id) : null;
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  for (const part of (header ?? "").split(";")) {
    const at = part.indexOf("=");
    if (at > 0) cookies[part.slice(0, at).trim()] = part.slice(at + 1).trim();
  }
  return cookies;
}

export type CookieOptions = { path: string; maxAgeSeconds: number; secure: boolean };

/** Adds a Set-Cookie header, keeping any set earlier in this reply. Always httpOnly and SameSite=Lax. */
export function setCookie(reply: FastifyReply, name: string, value: string, options: CookieOptions) {
  const cookie = [`${name}=${value}`, `Path=${options.path}`, `Max-Age=${options.maxAgeSeconds}`, "HttpOnly", "SameSite=Lax"];
  if (options.secure) cookie.push("Secure");
  const before = reply.getHeader("set-cookie");
  reply.header("set-cookie", [...(before === undefined ? [] : [before].flat().map(String)), cookie.join("; ")]);
}

export function clearCookie(reply: FastifyReply, name: string, path: string, secure: boolean) {
  setCookie(reply, name, "", { path, maxAgeSeconds: 0, secure });
}

/** Renders a page with `status`; every view gets the logged-in `owner` (or null) and the `csrf` token for its forms. */
export async function render(reply: FastifyReply, view: string, data: Record<string, unknown> = {}, status = 200) {
  const html = await ejs.renderFile(`${VIEWS}${view}.ejs`, {
    owner: reply.request.owner ?? null,
    csrf: reply.request.csrf ?? "",
    noindex: false,
    stream: "",
    ...data,
  });
  return reply.code(status).type("text/html; charset=utf-8").send(html);
}
```

```ts
// src/assign/context.ts
import type { WithId } from "mongodb";
import type { AssignConfig } from "./config.ts";
import type { Hub } from "./events.ts";
import type { Mailer } from "./mailer.ts";
import type { RateLimiter } from "./rate-limit.ts";
import type { AssignStore, OwnerDoc } from "./store.ts";

/** What every route file of the module works with. */
export type AssignContext = {
  store: AssignStore;
  config: AssignConfig;
  mailer: Mailer;
  now: () => Date;
  limiter: RateLimiter;
  hub: Hub;
};

declare module "fastify" {
  interface FastifyRequest {
    /** The logged-in Task assignment Owner, set on `/assign` routes behind login. */
    owner: WithId<OwnerDoc> | null;
    /** This browser's CSRF token, rendered into every form. */
    csrf: string;
  }
}
```

`context.ts` imports `Hub` from `events.ts`, which arrives in Task 3. For now, create `src/assign/events.ts` with only the hub; Task 3 adds `recordEvent`:

```ts
// src/assign/events.ts
import type { EventDoc } from "./store.ts";

/** Fans saved events out to open SSE streams in this process. */
export type Hub = { publish(event: EventDoc): void; subscribe(listener: (event: EventDoc) => void): () => void };

export function createHub(): Hub {
  const listeners = new Set<(event: EventDoc) => void>();
  return {
    publish(event) {
      for (const listener of listeners) listener(event);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
```

- [ ] **Step 10: Write `src/assign/auth.ts` (magic link and access session)**

```ts
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { ObjectId, type WithId } from "mongodb";
import type { AssignContext } from "./context.ts";
import { randomToken, sha256, signJwt, verifyJwt } from "./crypto.ts";
import { field, parseCookies, render, setCookie } from "./http.ts";
import type { OwnerDoc } from "./store.ts";

const MINUTE = 60_000;
export const ACCESS_SECONDS = 15 * 60;
const LINK_MINUTES = 15;
const EMAIL = /^[^\s@]{1,64}@[^\s@]+\.[^\s@]+$/;

export function normalEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

function maySignUp(ctx: AssignContext, email: string): boolean {
  return ctx.config.signupMode === "open" || ctx.config.allowedEmails.includes(email);
}

/** Sets the 15-minute access cookie for `owner`. Task 2 adds the refresh token. */
export async function startSession(ctx: AssignContext, reply: FastifyReply, owner: WithId<OwnerDoc>) {
  issueAccess(ctx, reply, owner);
}

export function issueAccess(ctx: AssignContext, reply: FastifyReply, owner: WithId<OwnerDoc>) {
  const exp = Math.floor(ctx.now().getTime() / 1000) + ACCESS_SECONDS;
  const token = signJwt({ sub: owner._id.toHexString(), sv: owner.sessionVersion, exp }, ctx.config.jwtSecret);
  setCookie(reply, "ta_access", token, { path: "/", maxAgeSeconds: ACCESS_SECONDS, secure: ctx.config.secureCookies });
}

/** The Owner whose access cookie is valid, or null. Task 2 extends this to renew from the refresh token. */
export async function currentOwner(
  ctx: AssignContext,
  request: FastifyRequest,
  _reply: FastifyReply,
): Promise<WithId<OwnerDoc> | null> {
  return ownerFromAccess(ctx, request);
}

export async function ownerFromAccess(ctx: AssignContext, request: FastifyRequest): Promise<WithId<OwnerDoc> | null> {
  const claims = verifyJwt(parseCookies(request.headers.cookie).ta_access, ctx.config.jwtSecret, ctx.now());
  if (!claims || typeof claims.sub !== "string" || !ObjectId.isValid(claims.sub)) return null;
  const owner = await ctx.store.owners.findOne({ _id: new ObjectId(claims.sub) });
  return owner && owner.sessionVersion === claims.sv ? owner : null;
}

/** An onRequest hook for routes behind login: pages redirect to the login page, anything else gets 401. */
export function requireOwner(ctx: AssignContext) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const owner = await currentOwner(ctx, request, reply);
    if (!owner) {
      return request.method === "GET"
        ? reply.redirect("/assign/login")
        : reply.code(401).type("text/plain").send("Your session ended. Log in again.");
    }
    request.owner = owner;
  };
}

/** Login routes, under `/assign`, open to anyone. */
export function loginRoutes(app: FastifyInstance, ctx: AssignContext) {
  const { store } = ctx;

  app.get("/login", (_request, reply) => render(reply, "login", { title: "Log in", error: null, email: "" }));

  app.post("/login", async (request, reply) => {
    const email = normalEmail(field(request.body as never, "email"));
    if (!EMAIL.test(email) || email.length > 254) {
      return render(reply, "login", { title: "Log in", error: "Enter a valid email address.", email }, 400);
    }
    const allowed =
      ctx.limiter.allow(`link:email:${email}`, 5, 15 * MINUTE) && ctx.limiter.allow(`link:ip:${request.ip}`, 5, 15 * MINUTE);
    if (allowed && ((await store.owners.findOne({ email })) || maySignUp(ctx, email))) {
      const token = randomToken();
      await store.loginTokens.insertOne({
        email,
        tokenHash: sha256(token),
        expiresAt: new Date(ctx.now().getTime() + LINK_MINUTES * MINUTE),
        usedAt: null,
      });
      const link = `${ctx.config.publicUrl}/assign/auth?token=${token}`;
      try {
        await ctx.mailer.send({
          to: email,
          subject: "Your login link",
          text: `Open this link to log in. It works once, for ${LINK_MINUTES} minutes:\n\n${link}\n\nIf you didn't ask for it, ignore this email.`,
        });
      } catch (error) {
        request.log.error(error, "Failed to send a login email");
      }
    }
    // The same page whatever happened, so it never tells whether the email has an account.
    return render(reply, "login-sent", { title: "Check your email" });
  });

  // Showing a button instead of logging in on GET: email scanners open links, and must not use them up.
  app.get("/auth", (request, reply) =>
    render(reply, "confirm-login", { title: "Log in", token: String((request.query as { token?: string }).token ?? "") }),
  );

  app.post("/auth", async (request, reply) => {
    const token = field(request.body as never, "token");
    const used = await store.loginTokens.findOneAndUpdate(
      { tokenHash: sha256(token), usedAt: null, expiresAt: { $gt: ctx.now() } },
      { $set: { usedAt: ctx.now() } },
    );
    const expired = "That link has expired or was already used. Ask for a new one.";
    if (!token || !used) return render(reply, "login", { title: "Log in", error: expired, email: "" }, 400);
    let owner = await store.owners.findOne({ email: used.email });
    if (!owner) {
      if (!maySignUp(ctx, used.email)) return render(reply, "login", { title: "Log in", error: expired, email: "" }, 400);
      if (!ctx.limiter.allow(`signup:ip:${request.ip}`, 5, 60 * MINUTE)) {
        const tooMany = "Too many new accounts from this network. Try again later.";
        return render(reply, "login", { title: "Log in", error: tooMany, email: "" }, 429);
      }
      const fresh: OwnerDoc = {
        email: used.email,
        passwordHash: null,
        passwordOffered: false,
        sessionVersion: 0,
        lastSeenEventSeq: 0,
        createdAt: ctx.now(),
      };
      try {
        await store.owners.insertOne(fresh);
      } catch {
        // Two links used at once for the same new email: the other request created it.
      }
      owner = (await store.owners.findOne({ email: used.email }))!;
    }
    await startSession(ctx, reply, owner);
    return reply.redirect(await afterLogin(ctx, owner), 303);
  });
}

/** Where a fresh login goes. Task 2 sends a first login to "Set a password?". */
export async function afterLogin(_ctx: AssignContext, _owner: WithId<OwnerDoc>): Promise<string> {
  return "/assign";
}
```

- [ ] **Step 11: Write the views**

`src/assign/views/header.ejs`:

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <% if (noindex) { %><meta name="robots" content="noindex, nofollow"><% } %>
  <meta name="csrf-token" content="<%= csrf %>">
  <title><%= title %> · Task assignment</title>
  <style>
    :root { color-scheme: light dark; --bg:#f7f7f8; --surface:#fff; --text:#1d1d1f; --muted:#5c5c66; --border:#d9d9de; --accent:#2f5bd3; --danger:#b3261e; --warning:#8a6100; --success:#1e6b34; }
    @media (prefers-color-scheme: dark) { :root { --bg:#121212; --surface:#1c1c1e; --text:#e0e0e0; --muted:#a3a3ab; --border:#3a3a40; --accent:#8fa7e6; --danger:#ef9a9f; --warning:#e9cd85; --success:#8fcf9e; } }
    * { box-sizing: border-box; }
    body { margin: 0 auto; max-width: 52rem; padding: 1rem; font: 16px/1.5 system-ui, sans-serif; background: var(--bg); color: var(--text); }
    a { color: var(--accent); }
    nav { display: flex; flex-wrap: wrap; gap: .75rem 1rem; padding-bottom: .5rem; margin-bottom: 1rem; border-bottom: 1px solid var(--border); }
    .card { background: var(--surface); border: 1px solid var(--border); border-radius: .5rem; padding: .75rem 1rem; margin: .5rem 0; }
    .muted { color: var(--muted); font-size: .875rem; }
    .blocked { color: var(--warning); } .done { color: var(--success); } .error { color: var(--danger); }
    .tag { display: inline-block; border: 1px solid var(--border); border-radius: 1rem; padding: 0 .5rem; font-size: .8rem; margin-right: .25rem; }
    .badge { background: var(--accent); color: var(--bg); border-radius: 1rem; padding: 0 .45rem; font-size: .8rem; }
    label { display: block; margin-top: .75rem; font-weight: 600; }
    input[type=text], input[type=email], input[type=password], textarea, select { width: 100%; font: inherit; padding: .4rem; background: var(--surface); color: var(--text); border: 1px solid var(--border); border-radius: .25rem; }
    button { font: inherit; padding: .35rem .8rem; margin-top: .5rem; border-radius: .25rem; border: 1px solid var(--border); background: var(--surface); color: var(--text); cursor: pointer; }
    button.primary { background: var(--accent); color: var(--bg); border-color: var(--accent); }
    form.inline { display: inline; }
    #alerts { position: fixed; right: 1rem; bottom: 1rem; display: grid; gap: .5rem; }
    #alerts div { background: var(--surface); border: 1px solid var(--accent); border-radius: .5rem; padding: .5rem .75rem; }
    @media (prefers-reduced-motion: no-preference) { #alerts div { animation: in .2s ease-out; } @keyframes in { from { opacity: 0; transform: translateY(.5rem); } } }
  </style>
</head>
<body data-stream="<%= stream %>">
<% if (owner) { %>
<nav>
  <a href="/assign">Board</a><a href="/assign/tasks">Tasks</a><a href="/assign/lists">Lists</a><a href="/assign/people">People</a>
  <a href="/assign/feed">Activity<% if (locals.unread) { %> <span class="badge" aria-label="<%= unread %> unread"><%= unread %></span><% } %></a>
  <a href="/assign/settings">Settings</a>
</nav>
<% } %>
<main>
```

`src/assign/views/footer.ejs`:

```html
</main>
<div id="alerts" aria-live="polite"></div>
<%- include("live") %>
</body>
</html>
```

`src/assign/views/live.ejs` (Task 8 fills in the stream; for now it only shows local times):

```html
<script>
  // Shows each <time datetime> in the viewer's local time, relative when recent ("10 min ago").
  function localTimes() {
    const units = [["day", 86400], ["hour", 3600], ["min", 60]];
    for (const element of document.querySelectorAll("time[datetime]")) {
      const at = new Date(element.getAttribute("datetime"));
      const seconds = Math.round((Date.now() - at.getTime()) / 1000);
      let text = at.toLocaleString();
      if (seconds < 60) text = "just now";
      else for (const [unit, size] of units) if (seconds >= size && seconds < size * 7 * (unit === "day" ? 1 : 24)) { const n = Math.floor(seconds / size); text = `${n} ${unit}${n === 1 || unit === "min" ? "" : "s"} ago`; break; }
      element.textContent = text;
      element.title = at.toLocaleString();
    }
  }
  localTimes();
</script>
```

`src/assign/views/login.ejs`:

```html
<%- include("header") %>
<h1>Log in</h1>
<% if (error) { %><p class="error" role="alert"><%= error %></p><% } %>
<form method="post" action="/assign/login" class="card">
  <input type="hidden" name="_csrf" value="<%= csrf %>">
  <label for="email">Email</label>
  <input type="email" id="email" name="email" value="<%= email %>" required autocomplete="email">
  <button class="primary">Email me a link</button>
</form>
<%- include("footer") %>
```

`src/assign/views/login-sent.ejs`:

```html
<%- include("header") %>
<h1>Check your email</h1>
<p>If that address can log in, a link is on its way. It works once, for 15 minutes.</p>
<p><a href="/assign/login">Use a different email</a></p>
<%- include("footer") %>
```

`src/assign/views/confirm-login.ejs`:

```html
<%- include("header") %>
<h1>Log in</h1>
<form method="post" action="/assign/auth" class="card">
  <input type="hidden" name="_csrf" value="<%= csrf %>">
  <input type="hidden" name="token" value="<%= token %>">
  <button class="primary">Log in</button>
</form>
<%- include("footer") %>
```

`src/assign/views/board.ejs` (Task 7 replaces it):

```html
<%- include("header") %>
<h1>Board</h1>
<p class="muted">Nothing assigned yet. Start by adding Tasks.</p>
<%- include("footer") %>
```

- [ ] **Step 12: Write `src/assign/index.ts`**

```ts
import type { FastifyPluginAsync } from "fastify";
import type { Db } from "mongodb";
import { loginRoutes, requireOwner } from "./auth.ts";
import type { AssignConfig } from "./config.ts";
import type { AssignContext } from "./context.ts";
import { createHub } from "./events.ts";
import { parseForm, render } from "./http.ts";
import type { Mailer } from "./mailer.ts";
import { createRateLimiter } from "./rate-limit.ts";
import { openAssignStore } from "./store.ts";

export type AssignOptions = { db: Db; config: AssignConfig; mailer: Mailer; now?: () => Date };

/** The Task assignment module (ADR 0006): Owner pages under /assign, Assignee pages under /l. */
export const assignRoutes: FastifyPluginAsync<AssignOptions> = async (app, options) => {
  const now = options.now ?? (() => new Date());
  const ctx: AssignContext = {
    store: await openAssignStore(options.db),
    config: options.config,
    mailer: options.mailer,
    now,
    limiter: createRateLimiter(now),
    hub: createHub(),
  };

  app.decorateRequest("owner", null);
  app.decorateRequest("csrf", "");
  app.addContentTypeParser("application/x-www-form-urlencoded", { parseAs: "string" }, (_request, body, done) => {
    done(null, parseForm(body as string));
  });

  // Open to anyone: logging in.
  await app.register(
    async (open) => {
      loginRoutes(open, ctx);
    },
    { prefix: "/assign" },
  );

  // Behind login: the Owner's workspace.
  await app.register(
    async (owner) => {
      owner.addHook("onRequest", requireOwner(ctx));
      owner.get("/", (_request, reply) => render(reply, "board", { title: "Board" }));
    },
    { prefix: "/assign" },
  );
};
```

- [ ] **Step 13: Wire it into the server and `main.ts`**

In `src/server.ts`, add the import and options, and pass `trustProxy` to Fastify:

```ts
import Fastify, { type FastifyInstance, type RouteHandlerMethod } from "fastify";
import { assignRoutes, type AssignOptions } from "./assign/index.ts";
import { dashboardRoutes, type DashboardOptions } from "./dashboard/dashboard.ts";
import { inventoryRoutes, type InventoryApiOptions } from "./inventory/api.ts";

export function buildServer(options: {
  logger?: boolean;
  inventory: InventoryApiOptions;
  /** Present in webhook mode: the route a Channel posts its updates to. */
  webhook?: { path: string; handler: RouteHandlerMethod };
  /** The Users' web dashboard, behind its own login. */
  dashboard?: DashboardOptions;
  /** The Task assignment module (ADR 0006), present only when configured. */
  assign?: AssignOptions;
  /** Behind a reverse proxy, so `request.ip` is the visitor's. */
  trustProxy?: boolean;
}): FastifyInstance {
  const server = Fastify({ logger: options.logger ?? true, trustProxy: options.trustProxy ?? false });
  server.get("/health", async () => ({ status: "ok" }));
  server.register(inventoryRoutes, { prefix: "/inventory", ...options.inventory });
  if (options.webhook) server.post(options.webhook.path, options.webhook.handler);
  if (options.dashboard) server.register(dashboardRoutes, options.dashboard);
  if (options.assign) server.register(assignRoutes, options.assign);
  return server;
}
```

In `src/main.ts`, add the imports:

```ts
import { AssignConfigError, loadAssignConfig } from "./assign/config.ts";
import { consoleMailer, resendMailer } from "./assign/mailer.ts";
```

After `config = loadConfig(process.env);` succeeds (still inside `main`, before connecting), add:

```ts
  let assignConfig;
  try {
    assignConfig = loadAssignConfig(process.env);
  } catch (error) {
    if (!(error instanceof AssignConfigError)) throw error;
    console.error(error.message);
    process.exit(1);
  }
```

and change the `buildServer` call to add:

```ts
    ...(assignConfig
      ? {
          assign: {
            db: database.db,
            config: assignConfig,
            mailer: assignConfig.resend ? resendMailer(assignConfig.resend) : consoleMailer(),
          },
          trustProxy: assignConfig.trustProxy,
        }
      : {}),
```

- [ ] **Step 14: Run the tests and see them pass**

Run: `npx tsc --noEmit && npx vitest run test/assign test/architecture.test.ts`
Expected: PASS, all of `login.test.ts`, `config.test.ts` and both architecture suites.

- [ ] **Step 15: Run the whole suite**

Run: `npm test`
Expected: every test passes, including the existing ones.

- [ ] **Step 16: Commit**

```bash
git add package.json .env.example src/server.ts src/main.ts src/assign test/assign test/architecture.test.ts
git commit -m "Task assignment: module setup and magic-link login (ticket 01)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Tick the boxes in `.scratch/task-assignment/issues/01-module-and-magic-link-login.md` and set `Status: done` in the same commit.

---

### Task 2: Sessions, passwords and CSRF (ticket 02)

**Files:**
- Modify: `src/assign/crypto.ts`, `src/assign/auth.ts`, `src/assign/index.ts`, `src/assign/views/login.ejs`
- Create: `src/assign/views/settings.ejs`
- Test: `test/assign/sessions.test.ts`

**Interfaces:**
- Consumes: `startSession`, `issueAccess`, `ownerFromAccess`, `currentOwner`, `afterLogin`, `AssignContext`, `setCookie`, `clearCookie`, `parseCookies`, `randomToken`, `sha256`, `safeEqual`
- Produces: `hashPassword(password): Promise<string>`, `verifyPassword(password, stored): Promise<boolean>`, `csrfHooks(ctx): { onRequest; preHandler }`, `settingsRoutes(app, ctx)`. `startSession` now also issues the refresh token. `currentOwner` now renews from it.

- [ ] **Step 1: Write the failing tests**

`test/assign/sessions.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { strip, useAssignApp } from "./harness.ts";

const MINUTE = 60_000;

describe("Task assignment: sessions", () => {
  const t = useAssignApp();

  it("renews an expired access token from the refresh token, rotating it", async () => {
    const browser = await t.logIn("sara@example.com");
    const firstRefresh = browser.cookies.get("ta_refresh");
    expect(firstRefresh).toBeTruthy();

    t.clock.advance(16 * MINUTE);
    expect((await browser.get("/assign")).statusCode).toBe(200);
    expect(browser.cookies.get("ta_refresh")).not.toBe(firstRefresh);
    expect(await t.store().refreshTokens.countDocuments({ tokenHash: firstRefresh })).toBe(0);
  });

  it("revokes every session when an old refresh token is reused after the grace period", async () => {
    const browser = await t.logIn("sara@example.com");
    const stolen = browser.cookies.get("ta_refresh")!;
    t.clock.advance(16 * MINUTE);
    await browser.get("/assign");

    t.clock.advance(MINUTE);
    const thief = t.agent("198.51.100.7");
    thief.cookies.set("ta_refresh", stolen);
    expect((await thief.get("/assign")).statusCode).toBe(302);

    t.clock.advance(16 * MINUTE);
    expect((await browser.get("/assign")).statusCode).toBe(302);
  });

  it("lets parallel requests with the same refresh token through within 30 seconds", async () => {
    const browser = await t.logIn("sara@example.com");
    const refresh = browser.cookies.get("ta_refresh")!;
    t.clock.advance(16 * MINUTE);
    const tab = t.agent();
    tab.cookies.set("ta_refresh", refresh);

    expect((await browser.get("/assign")).statusCode).toBe(200);
    expect((await tab.get("/assign")).statusCode).toBe(200);
    t.clock.advance(16 * MINUTE);
    expect((await browser.get("/assign")).statusCode).toBe(200);
  });

  it("marks cookies httpOnly and SameSite=Lax", async () => {
    const browser = t.agent();
    await browser.get("/assign/login");
    await browser.post("/assign/login", { email: "sara@example.com" });
    const token = new URL(t.lastLink(), "http://x").searchParams.get("token")!;
    const reply = await browser.post("/assign/auth", { token });
    const cookies = [reply.headers["set-cookie"]].flat().join("\n");
    expect(cookies).toMatch(/ta_access=[^;]+; Path=\/; Max-Age=900; HttpOnly; SameSite=Lax/);
    expect(cookies).toMatch(/ta_refresh=[^;]+; Path=\/assign; Max-Age=2592000; HttpOnly; SameSite=Lax/);
    expect(cookies).not.toContain("Secure");
  });

  it("logs out this browser only, and signs out everywhere", async () => {
    const laptop = await t.logIn("sara@example.com");
    const phone = await t.logIn("sara@example.com", t.agent("192.0.2.9"));

    await laptop.post("/assign/logout");
    expect((await laptop.get("/assign")).statusCode).toBe(302);
    expect((await phone.get("/assign")).statusCode).toBe(200);

    const tablet = await t.logIn("sara@example.com", t.agent("192.0.2.10"));
    await tablet.post("/assign/logout-everywhere");
    expect((await phone.get("/assign")).statusCode).toBe(302);
    expect((await tablet.get("/assign")).statusCode).toBe(302);
  });
});

describe("Task assignment: passwords", () => {
  const t = useAssignApp();

  it("offers a password once after the first login, with a Skip", async () => {
    const browser = t.agent();
    await browser.get("/assign/login");
    await browser.post("/assign/login", { email: "sara@example.com" });
    const token = new URL(t.lastLink(), "http://x").searchParams.get("token")!;
    const first = await browser.post("/assign/auth", { token });
    expect(first.headers.location).toBe("/assign/settings?first=1");
    const page = await browser.get("/assign/settings?first=1");
    expect(page.body).toContain("Set a password?");
    expect(page.body).toContain('href="/assign"');

    await t.logIn("sara@example.com", browser);
    expect((await t.store().owners.findOne({}))!.passwordHash).toBeNull();
  });

  it("logs in with a password once one is set, and refuses short ones", async () => {
    const browser = await t.logIn("sara@example.com");
    const short = await browser.post("/assign/settings/password", { password: "123456789" });
    expect(short.statusCode).toBe(400);
    expect(short.body).toContain("at least 10 characters");

    expect((await browser.post("/assign/settings/password", { password: "correct horse" })).statusCode).toBe(303);
    expect((await t.store().owners.findOne({}))!.passwordHash).toMatch(/^argon2id\$/);

    const other = t.agent("192.0.2.40");
    await other.get("/assign/login");
    const wrong = await other.post("/assign/login/password", { email: "sara@example.com", password: "wrong horse!" });
    const unknown = await other.post("/assign/login/password", { email: "eve@example.com", password: "wrong horse!" });
    expect(wrong.statusCode).toBe(400);
    expect(strip(wrong.body)).toBe(strip(unknown.body));
    const right = await other.post("/assign/login/password", { email: "sara@example.com", password: "correct horse" });
    expect(right.statusCode).toBe(303);
    expect((await other.get("/assign")).statusCode).toBe(200);
  });

  it("allows 5 password tries per 15 minutes per email", async () => {
    const browser = await t.logIn("sara@example.com");
    await browser.post("/assign/settings/password", { password: "correct horse" });
    const other = t.agent("192.0.2.41");
    await other.get("/assign/login");
    for (let i = 0; i < 5; i++) await other.post("/assign/login/password", { email: "sara@example.com", password: "nope nope nope" });
    const blocked = await other.post("/assign/login/password", { email: "sara@example.com", password: "correct horse" });
    expect(blocked.statusCode).toBe(400);
  });

  it("signs out other sessions when the password changes", async () => {
    const laptop = await t.logIn("sara@example.com");
    const phone = await t.logIn("sara@example.com", t.agent("192.0.2.9"));
    await laptop.post("/assign/settings/password", { password: "correct horse" });
    expect((await phone.get("/assign")).statusCode).toBe(302);
    expect((await laptop.get("/assign")).statusCode).toBe(200);
  });
});

describe("Task assignment: CSRF", () => {
  const t = useAssignApp();

  it("refuses a form without the matching CSRF token", async () => {
    const browser = await t.logIn("sara@example.com");
    const forged = await browser.post("/assign/logout", { _csrf: "forged" });
    expect(forged.statusCode).toBe(403);
    expect((await browser.get("/assign")).statusCode).toBe(200);

    // A browser with no CSRF cookie at all (a cross-site form post).
    const fresh = t.agent();
    expect((await fresh.post("/assign/login", { email: "sara@example.com", _csrf: "" })).statusCode).toBe(403);
  });

  it("accepts the token in an x-csrf-token header", async () => {
    const browser = await t.logIn("sara@example.com");
    const reply = await browser.post("/assign/logout", { _csrf: "" }, { "x-csrf-token": browser.cookies.get("ta_csrf")! });
    expect(reply.statusCode).toBe(303);
  });
});

describe("Task assignment: secure cookies over https", () => {
  const t = useAssignApp({ config: { secureCookies: true, publicUrl: "https://assign.test" } });

  it("marks cookies Secure", async () => {
    const reply = await t.agent().get("/assign/login");
    expect([reply.headers["set-cookie"]].flat().join("\n")).toMatch(/ta_csrf=[^;]+;.*Secure/);
  });
});
```

The `x-csrf-token` test passes `_csrf: ""` so the harness doesn't add the field; the CSRF hook must read the header first and use the field only when the header is absent.

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run test/assign/sessions.test.ts`
Expected: FAIL. There's no `ta_refresh` cookie, and `/assign/logout` returns 404.

- [ ] **Step 3: Add argon2id to `src/assign/crypto.ts`**

```ts
import { argon2, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const ARGON2 = { memory: 19_456, passes: 2, parallelism: 1, tagLength: 32 };

function argon2id(message: string, nonce: Buffer, cost: typeof ARGON2): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    argon2("argon2id", { message, nonce, ...cost }, (error, key) => (error ? reject(error) : resolve(key))),
  );
}

/** `argon2id$m=…,t=…,p=…$<nonce>$<hash>`, both base64. */
export async function hashPassword(password: string): Promise<string> {
  const nonce = randomBytes(16);
  const key = await argon2id(password, nonce, ARGON2);
  return `argon2id$m=${ARGON2.memory},t=${ARGON2.passes},p=${ARGON2.parallelism}$${nonce.toString("base64")}$${key.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algorithm, cost, nonce, hash] = stored.split("$");
  if (algorithm !== "argon2id" || !cost || !nonce || !hash) return false;
  const params = Object.fromEntries(cost.split(",").map((pair) => pair.split("=")));
  const expected = Buffer.from(hash, "base64");
  const key = await argon2id(password, Buffer.from(nonce, "base64"), {
    memory: Number(params.m),
    passes: Number(params.t),
    parallelism: Number(params.p),
    tagLength: expected.length,
  });
  return timingSafeEqual(key, expected);
}

let decoy: Promise<string> | undefined;
/** A hash to verify against when the email has no password, so the reply takes as long either way. */
export function decoyHash(): Promise<string> {
  decoy ??= hashPassword(randomToken());
  return decoy;
}
```

(Keep the Task 1 functions; merge the `node:crypto` import into one line.)

- [ ] **Step 4: Add refresh tokens, renewal, logout and CSRF to `src/assign/auth.ts`**

Replace `startSession` and `currentOwner`, and add the rest:

```ts
const REFRESH_SECONDS = 30 * 24 * 60 * 60;
/** Parallel requests right after expiry all carry the same refresh token; reuse this soon after is not theft. */
const REUSE_GRACE_MS = 30_000;

/** Sets the access cookie and a new refresh token in `family` (a new family for a fresh login). */
export async function startSession(ctx: AssignContext, reply: FastifyReply, owner: WithId<OwnerDoc>, family = randomToken(16)) {
  issueAccess(ctx, reply, owner);
  const token = randomToken();
  const { insertedId } = await ctx.store.refreshTokens.insertOne({
    ownerId: owner._id,
    family,
    tokenHash: sha256(token),
    expiresAt: new Date(ctx.now().getTime() + REFRESH_SECONDS * 1000),
    revokedAt: null,
    replacedBy: null,
  });
  setCookie(reply, "ta_refresh", token, { path: "/assign", maxAgeSeconds: REFRESH_SECONDS, secure: ctx.config.secureCookies });
  return insertedId;
}

export async function currentOwner(ctx: AssignContext, request: FastifyRequest, reply: FastifyReply) {
  return (await ownerFromAccess(ctx, request)) ?? (await renewFromRefresh(ctx, request, reply));
}

async function renewFromRefresh(ctx: AssignContext, request: FastifyRequest, reply: FastifyReply) {
  const token = parseCookies(request.headers.cookie).ta_refresh;
  if (!token) return null;
  const now = ctx.now();
  const found = await ctx.store.refreshTokens.findOne({ tokenHash: sha256(token) });
  if (!found || found.expiresAt <= now) return null;
  const owner = await ctx.store.owners.findOne({ _id: found.ownerId });
  if (!owner) return null;

  if (found.revokedAt) {
    if (found.replacedBy && now.getTime() - found.revokedAt.getTime() <= REUSE_GRACE_MS) {
      // A request racing the one that rotated it: let it through on a new access token only.
      issueAccess(ctx, reply, owner);
      return owner;
    }
    // A rotated token used again later: someone else may hold it, so end every session from that login.
    if (found.replacedBy) {
      await ctx.store.refreshTokens.updateMany({ ownerId: found.ownerId, family: found.family, revokedAt: null }, { $set: { revokedAt: now } });
    }
    return null;
  }
  const claimed = await ctx.store.refreshTokens.findOneAndUpdate({ _id: found._id, revokedAt: null }, { $set: { revokedAt: now } });
  if (!claimed) {
    issueAccess(ctx, reply, owner);
    return owner;
  }
  const replacedBy = await startSession(ctx, reply, owner, found.family);
  await ctx.store.refreshTokens.updateOne({ _id: found._id }, { $set: { replacedBy } });
  return owner;
}

/** Ends every session of the Owner: refresh tokens revoked, outstanding access tokens made stale. */
async function endAllSessions(ctx: AssignContext, ownerId: ObjectId) {
  await ctx.store.owners.updateOne({ _id: ownerId }, { $inc: { sessionVersion: 1 } });
  await ctx.store.refreshTokens.updateMany({ ownerId, revokedAt: null }, { $set: { revokedAt: ctx.now() } });
}

function clearSessionCookies(ctx: AssignContext, reply: FastifyReply) {
  clearCookie(reply, "ta_access", "/", ctx.config.secureCookies);
  clearCookie(reply, "ta_refresh", "/assign", ctx.config.secureCookies);
}

export async function afterLogin(ctx: AssignContext, owner: WithId<OwnerDoc>): Promise<string> {
  if (owner.passwordHash || owner.passwordOffered) return "/assign";
  await ctx.store.owners.updateOne({ _id: owner._id }, { $set: { passwordOffered: true } });
  return "/assign/settings?first=1";
}

/** A CSRF token cookie per browser (double submit), checked on every non-GET `/assign` request. */
export function csrfHooks(ctx: AssignContext) {
  return {
    onRequest: async (request: FastifyRequest, reply: FastifyReply) => {
      const sent = parseCookies(request.headers.cookie).ta_csrf;
      if (sent && /^[A-Za-z0-9_-]{43}$/.test(sent)) {
        request.csrf = sent;
        return;
      }
      request.csrf = randomToken();
      setCookie(reply, "ta_csrf", request.csrf, { path: "/assign", maxAgeSeconds: REFRESH_SECONDS, secure: ctx.config.secureCookies });
    },
    preHandler: async (request: FastifyRequest, reply: FastifyReply) => {
      if (request.method === "GET" || request.method === "HEAD") return;
      const header = request.headers["x-csrf-token"];
      const given = typeof header === "string" && header ? header : field(request.body as never, "_csrf");
      const hadCookie = parseCookies(request.headers.cookie).ta_csrf === request.csrf;
      if (!hadCookie || !given || !safeEqual(given, request.csrf)) {
        return reply.code(403).type("text/plain").send("This form has expired. Go back, refresh the page and try again.");
      }
    },
  };
}
```

Add to `loginRoutes`:

```ts
  app.post("/login/password", async (request, reply) => {
    const form = request.body as never;
    const email = normalEmail(field(form, "email"));
    const password = field(form, "password");
    const failed = () =>
      render(reply, "login", { title: "Log in", email, error: "That email and password don't match, or there were too many tries. Use “Email me a link” instead." }, 400);
    if (!ctx.limiter.allow(`password:${email}`, 5, 15 * MINUTE)) return failed();
    const owner = await store.owners.findOne({ email });
    const matches = await verifyPassword(password, owner?.passwordHash ?? (await decoyHash()));
    if (!owner?.passwordHash || !matches) return failed();
    await startSession(ctx, reply, owner);
    return reply.redirect("/assign", 303);
  });
```

Add a new route file section in `auth.ts` for logged-in Owners:

```ts
/** Settings, password and logout; registered behind login. */
export function settingsRoutes(app: FastifyInstance, ctx: AssignContext) {
  app.get("/settings", (request, reply) =>
    render(reply, "settings", { title: "Settings", first: (request.query as { first?: string }).first === "1", error: null }),
  );

  app.post("/settings/password", async (request, reply) => {
    const password = field(request.body as never, "password");
    if (password.length < 10 || password.length > 200) {
      return render(reply, "settings", { title: "Settings", first: false, error: "Use at least 10 characters (and at most 200)." }, 400);
    }
    const owner = request.owner!;
    await ctx.store.owners.updateOne({ _id: owner._id }, { $set: { passwordHash: await hashPassword(password) } });
    await endAllSessions(ctx, owner._id);
    await startSession(ctx, reply, (await ctx.store.owners.findOne({ _id: owner._id }))!);
    return reply.redirect("/assign/settings", 303);
  });

  app.post("/logout", async (request, reply) => {
    const token = parseCookies(request.headers.cookie).ta_refresh;
    const found = token && (await ctx.store.refreshTokens.findOne({ tokenHash: sha256(token) }));
    if (found) {
      await ctx.store.refreshTokens.updateMany({ ownerId: found.ownerId, family: found.family, revokedAt: null }, { $set: { revokedAt: ctx.now() } });
    }
    clearSessionCookies(ctx, reply);
    return reply.redirect("/assign/login", 303);
  });

  app.post("/logout-everywhere", async (request, reply) => {
    await endAllSessions(ctx, request.owner!._id);
    clearSessionCookies(ctx, reply);
    return reply.redirect("/assign/login", 303);
  });
}
```

Update the imports at the top of `auth.ts`: `decoyHash, hashPassword, randomToken, safeEqual, sha256, signJwt, verifyJwt, verifyPassword` from `./crypto.ts`, and `clearCookie, field, parseCookies, render, setCookie` from `./http.ts`.

Single logout leaves the access token valid for up to 15 minutes in another tab, but this browser's cookies are gone, so this browser is logged out. That's the behaviour the test checks.

- [ ] **Step 5: Register the hooks and routes in `src/assign/index.ts`**

```ts
  const csrf = csrfHooks(ctx);

  await app.register(
    async (open) => {
      open.addHook("onRequest", csrf.onRequest);
      open.addHook("preHandler", csrf.preHandler);
      loginRoutes(open, ctx);
    },
    { prefix: "/assign" },
  );

  await app.register(
    async (owner) => {
      owner.addHook("onRequest", csrf.onRequest);
      owner.addHook("onRequest", requireOwner(ctx));
      owner.addHook("preHandler", csrf.preHandler);
      owner.get("/", (_request, reply) => render(reply, "board", { title: "Board" }));
      settingsRoutes(owner, ctx);
    },
    { prefix: "/assign" },
  );
```

with `import { csrfHooks, loginRoutes, requireOwner, settingsRoutes } from "./auth.ts";`.

- [ ] **Step 6: Add the password form to the login page and write the settings page**

In `src/assign/views/login.ejs`, after the first form:

```html
<form method="post" action="/assign/login/password" class="card">
  <input type="hidden" name="_csrf" value="<%= csrf %>">
  <p class="muted">Or, if you've set a password:</p>
  <label for="pw-email">Email</label>
  <input type="email" id="pw-email" name="email" value="<%= email %>" required autocomplete="username">
  <label for="password">Password</label>
  <input type="password" id="password" name="password" required autocomplete="current-password">
  <button>Log in with password</button>
</form>
```

`src/assign/views/settings.ejs`:

```html
<%- include("header") %>
<h1><%= first ? "Set a password?" : "Settings" %></h1>
<% if (first) { %><p>You can keep logging in by email link, or set a password to log in faster.</p><% } %>
<% if (error) { %><p class="error" role="alert"><%= error %></p><% } %>
<form method="post" action="/assign/settings/password" class="card">
  <input type="hidden" name="_csrf" value="<%= csrf %>">
  <label for="password"><%= owner.passwordHash ? "New password" : "Password" %></label>
  <input type="password" id="password" name="password" minlength="10" required autocomplete="new-password">
  <button class="primary">Save password</button>
  <% if (first) { %> <a href="/assign">Skip</a><% } %>
</form>
<% if (!first) { %>
<form method="post" action="/assign/logout" class="inline"><input type="hidden" name="_csrf" value="<%= csrf %>"><button>Log out</button></form>
<form method="post" action="/assign/logout-everywhere" class="inline"><input type="hidden" name="_csrf" value="<%= csrf %>"><button>Sign out everywhere</button></form>
<% } %>
<%- include("footer") %>
```

- [ ] **Step 7: Run the tests and see them pass**

Run: `npx tsc --noEmit && npx vitest run test/assign`
Expected: PASS, including Task 1's login tests. The harness now posts `_csrf` from the cookie it got on `GET /assign/login`.

- [ ] **Step 8: Commit** (tick ticket 02, `Status: done`)

```bash
git add src/assign test/assign .scratch/task-assignment/issues/02-sessions-passwords-csrf.md
git commit -m "Task assignment: sessions, passwords and CSRF (ticket 02)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Tasks and tags (ticket 03)

**Files:**
- Modify: `src/assign/events.ts`, `src/assign/index.ts`
- Create: `src/assign/tasks.ts`, `src/assign/views/tasks.ejs`, `src/assign/views/task.ejs`
- Test: `test/assign/tasks.test.ts`

**Interfaces:**
- Consumes: `AssignContext`, `render`, `field`, `fields`, `parseId`, `TaskDoc`, `EventDoc`
- Produces:
  - `recordEvent(ctx, input: EventInput): Promise<EventDoc>` and `latestSeq(store): Promise<number>`
  - `LIMITS`
  - `parseTags(raw): string[] | { error: string }`
  - `setStatus(ctx, task, status, reason, actor: Actor): Promise<string | null>`, where `Actor = { kind: "owner" } | { kind: "assignee"; name: string; personId: ObjectId }` and the result is an error message or null
  - `setNote(ctx, task, note, actor): Promise<string | null>`
  - `findOwnTask(ctx, ownerId, id)`
  - `taskRoutes(app, ctx)`

- [ ] **Step 1: Write the failing tests**

`test/assign/tasks.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { useAssignApp, type Agent } from "./harness.ts";

describe("Task assignment: Tasks and tags", () => {
  const t = useAssignApp();

  /** Creates a Task and returns its ID. */
  async function create(browser: Agent, title: string, extra: Record<string, string> = {}) {
    const reply = await browser.post("/assign/tasks", { title, ...extra });
    expect(reply.statusCode).toBe(303);
    return (await t.store().tasks.findOne({ title }))!._id.toHexString();
  }

  it("creates an open Task in no List, and lists it in the pool", async () => {
    const browser = await t.logIn("sara@example.com");
    await create(browser, "Pack the books", { tags: "Kitchen, kitchen ,  Fragile", instruction: "Use the small boxes" });

    const task = (await t.store().tasks.findOne({ title: "Pack the books" }))!;
    expect(task).toMatchObject({ status: "open", listId: null, tags: ["kitchen", "fragile"], instruction: "Use the small boxes", note: "", blockedReason: "" });
    const pool = await browser.get("/assign/tasks");
    expect(pool.body).toContain("Pack the books");
  });

  it("filters the pool by tag", async () => {
    const browser = await t.logIn("sara@example.com");
    await create(browser, "Pack the books", { tags: "kitchen" });
    await create(browser, "Fix the door", { tags: "hall" });
    const filtered = await browser.get("/assign/tasks?tag=kitchen");
    expect(filtered.body).toContain("Pack the books");
    expect(filtered.body).not.toContain("Fix the door");
  });

  it("refuses too many or too long tags, long titles and long text", async () => {
    const browser = await t.logIn("sara@example.com");
    expect((await browser.post("/assign/tasks", { title: "x", tags: "a,b,c,d,e,f" })).body).toContain("At most 5 tags");
    expect((await browser.post("/assign/tasks", { title: "x", tags: "t".repeat(31) })).statusCode).toBe(400);
    expect((await browser.post("/assign/tasks", { title: "t".repeat(201) })).statusCode).toBe(400);
    expect((await browser.post("/assign/tasks", { title: "" })).statusCode).toBe(400);
    expect((await browser.post("/assign/tasks", { title: "x", instruction: "i".repeat(2001) })).statusCode).toBe(400);
    expect(await t.store().tasks.countDocuments()).toBe(0);
  });

  it("escapes HTML in what it shows", async () => {
    const browser = await t.logIn("sara@example.com");
    await create(browser, "<script>alert(1)</script>");
    const pool = await browser.get("/assign/tasks");
    expect(pool.body).not.toContain("<script>alert(1)</script>");
    expect(pool.body).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it("edits a Task and clears its note", async () => {
    const browser = await t.logIn("sara@example.com");
    const id = await create(browser, "Pack the books");
    await t.store().tasks.updateOne({}, { $set: { note: "Done half" } });

    await browser.post(`/assign/tasks/${id}`, { title: "Pack all books", tags: "study", instruction: "Label boxes", note: "" });
    expect(await t.store().tasks.findOne({})).toMatchObject({ title: "Pack all books", tags: ["study"], instruction: "Label boxes", note: "" });
  });

  it("needs a reason to block, clears it when unblocked, and reopens", async () => {
    const browser = await t.logIn("sara@example.com");
    const id = await create(browser, "Fix the door");
    const noReason = await browser.post(`/assign/tasks/${id}/status`, { status: "blocked" });
    expect(noReason.statusCode).toBe(400);
    expect(noReason.body).toContain("Say why");

    await browser.post(`/assign/tasks/${id}/status`, { status: "blocked", reason: "No screws" });
    expect(await t.store().tasks.findOne({})).toMatchObject({ status: "blocked", blockedReason: "No screws" });
    await browser.post(`/assign/tasks/${id}/status`, { status: "done" });
    expect(await t.store().tasks.findOne({})).toMatchObject({ status: "done", blockedReason: "" });
    await browser.post(`/assign/tasks/${id}/status`, { status: "open" });
    expect((await t.store().tasks.findOne({}))!.status).toBe("open");
  });

  it("records each change as an event", async () => {
    const browser = await t.logIn("sara@example.com");
    const id = await create(browser, "Fix the door");
    await browser.post(`/assign/tasks/${id}`, { title: "Fix the back door", tags: "", instruction: "", note: "" });
    await browser.post(`/assign/tasks/${id}/status`, { status: "done" });
    await browser.post(`/assign/tasks/${id}/delete`);

    const events = await t.store().events.find().sort({ seq: 1 }).toArray();
    expect(events.map((event) => event.kind)).toEqual(["task-created", "task-edited", "task-status", "task-deleted"]);
    expect(events[2]).toMatchObject({ from: "open", to: "done", actor: "owner" });
    expect(events.map((event) => event.seq)).toEqual([1, 2, 3, 4]);
  });

  it("hides one Owner's Tasks from another, even by ID", async () => {
    const sara = await t.logIn("sara@example.com");
    const id = await create(sara, "Sara's task");
    const omar = await t.logIn("omar@example.com", t.agent("192.0.2.2"));

    expect((await omar.get("/assign/tasks")).body).not.toContain("Sara's task");
    expect((await omar.get(`/assign/tasks/${id}`)).statusCode).toBe(404);
    expect((await omar.post(`/assign/tasks/${id}/status`, { status: "done" })).statusCode).toBe(404);
    expect((await omar.post(`/assign/tasks/${id}/delete`)).statusCode).toBe(404);
    expect((await t.store().tasks.findOne({}))!.status).toBe("open");
  });
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run test/assign/tasks.test.ts`
Expected: FAIL with 404 on `POST /assign/tasks`.

- [ ] **Step 3: Add `recordEvent` to `src/assign/events.ts`**

```ts
import type { AssignContext } from "./context.ts";
import type { AssignStore, EventDoc } from "./store.ts";

export type EventInput = Pick<EventDoc, "ownerId" | "kind" | "summary"> &
  Partial<Pick<EventDoc, "actor" | "taskId" | "listId" | "personId" | "assignmentId" | "from" | "to">>;

/** Saves the event with the next sequence number, then broadcasts it (TA-NFR-7: save first). */
export async function recordEvent(ctx: Pick<AssignContext, "store" | "hub" | "now">, input: EventInput): Promise<EventDoc> {
  const counter = await ctx.store.counters.findOneAndUpdate(
    { _id: "events" },
    { $inc: { seq: 1 } },
    { upsert: true, returnDocument: "after" },
  );
  const event: EventDoc = {
    seq: counter!.seq,
    actor: "owner",
    taskId: null,
    listId: null,
    personId: null,
    assignmentId: null,
    from: null,
    to: null,
    ...input,
    createdAt: ctx.now(),
  };
  await ctx.store.events.insertOne(event);
  ctx.hub.publish(event);
  return event;
}

/** The newest sequence number handed out, or 0. */
export async function latestSeq(store: AssignStore): Promise<number> {
  return (await store.counters.findOne({ _id: "events" }))?.seq ?? 0;
}
```

(Keep `Hub` and `createHub` from Task 1 in the same file.)

- [ ] **Step 4: Write `src/assign/tasks.ts`**

```ts
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { ObjectId, WithId } from "mongodb";
import type { AssignContext } from "./context.ts";
import { recordEvent } from "./events.ts";
import { field, parseId, render, type Form } from "./http.ts";
import type { TaskDoc, TaskStatus } from "./store.ts";

export const LIMITS = { title: 200, text: 2000, tags: 5, tag: 30, tasksPerList: 50 } as const;
const STATUSES: TaskStatus[] = ["open", "blocked", "done"];

export type Actor = { kind: "owner" } | { kind: "assignee"; name: string; personId: ObjectId };

/** "Kitchen, kitchen ,  Fragile" → ["kitchen", "fragile"]. */
export function parseTags(raw: string): string[] | { error: string } {
  const tags = [...new Set(raw.split(",").map((tag) => tag.trim().toLowerCase()).filter(Boolean))];
  if (tags.length > LIMITS.tags) return { error: `At most ${LIMITS.tags} tags.` };
  if (tags.some((tag) => tag.length > LIMITS.tag)) return { error: `Each tag can be at most ${LIMITS.tag} characters.` };
  return tags;
}

/** The title, tags and instruction from a Task form, or the first problem with them. */
function readTaskForm(form: Form): { title: string; tags: string[]; instruction: string } | { error: string } {
  const title = field(form, "title");
  const instruction = field(form, "instruction");
  if (!title) return { error: "Give the Task a title." };
  if (title.length > LIMITS.title) return { error: `Titles can be at most ${LIMITS.title} characters.` };
  if (instruction.length > LIMITS.text) return { error: `Instructions can be at most ${LIMITS.text} characters.` };
  const tags = parseTags(field(form, "tags"));
  if (!Array.isArray(tags)) return tags;
  return { title, tags, instruction };
}

export function findOwnTask(ctx: AssignContext, ownerId: ObjectId, id: string | undefined) {
  const _id = parseId(id);
  return _id ? ctx.store.tasks.findOne({ _id, ownerId }) : Promise.resolve(null);
}

const who = (actor: Actor) => (actor.kind === "owner" ? "You" : actor.name);

/** Changes a Task's status for the Owner or an Assignee; an error message, or null when done. */
export async function setStatus(
  ctx: AssignContext,
  task: WithId<TaskDoc>,
  status: string,
  rawReason: string,
  actor: Actor,
): Promise<string | null> {
  if (!STATUSES.includes(status as TaskStatus)) return "Choose open, blocked or done.";
  const reason = rawReason.trim();
  if (status === "blocked" && !reason) return "Say why it's blocked.";
  if (reason.length > LIMITS.text) return `Reasons can be at most ${LIMITS.text} characters.`;
  const blockedReason = status === "blocked" ? reason : "";
  await ctx.store.tasks.updateOne(
    { _id: task._id, ownerId: task.ownerId },
    { $set: { status: status as TaskStatus, blockedReason, updatedAt: ctx.now() } },
  );
  const wording = status === "blocked" ? `blocked: ${reason}` : status === "done" ? "done" : "open again";
  await recordEvent(ctx, {
    ownerId: task.ownerId,
    kind: "task-status",
    actor: actor.kind,
    summary: `${who(actor)} marked “${task.title}” ${wording}`,
    taskId: task._id,
    listId: task.listId,
    personId: actor.kind === "assignee" ? actor.personId : null,
    from: task.status,
    to: status,
  });
  await afterStatusChange(ctx, task, status as TaskStatus);
  return null;
}

/** Hook for Task 7 (one "list complete" event); does nothing yet. */
async function afterStatusChange(_ctx: AssignContext, _task: WithId<TaskDoc>, _status: TaskStatus) {}

export async function setNote(ctx: AssignContext, task: WithId<TaskDoc>, rawNote: string, actor: Actor): Promise<string | null> {
  const note = rawNote.trim();
  if (note.length > LIMITS.text) return `Notes can be at most ${LIMITS.text} characters.`;
  if (note === task.note) return null;
  await ctx.store.tasks.updateOne({ _id: task._id, ownerId: task.ownerId }, { $set: { note, updatedAt: ctx.now() } });
  await recordEvent(ctx, {
    ownerId: task.ownerId,
    kind: "task-note",
    actor: actor.kind,
    summary: note ? `${who(actor)} left a note on “${task.title}”` : `${who(actor)} cleared the note on “${task.title}”`,
    taskId: task._id,
    listId: task.listId,
    personId: actor.kind === "assignee" ? actor.personId : null,
    from: task.note || null,
    to: note || null,
  });
  return null;
}

/** The Task pool, under `/assign`, behind login. */
export function taskRoutes(app: FastifyInstance, ctx: AssignContext) {
  const { store } = ctx;

  const showPool = async (request: FastifyRequest, reply: FastifyReply, error: string | null = null, status = 200) => {
    const ownerId = request.owner!._id;
    const tag = String((request.query as { tag?: string }).tag ?? "").toLowerCase();
    const tasks = await store.tasks.find({ ownerId, ...(tag ? { tags: tag } : {}) }).sort({ createdAt: -1 }).toArray();
    const lists = await store.lists.find({ ownerId }).toArray();
    const listNames = Object.fromEntries(lists.map((list) => [list._id.toHexString(), list.name]));
    const allTags = (await store.tasks.distinct("tags", { ownerId })).sort();
    return render(reply, "tasks", { title: "Tasks", tasks, tag, allTags, listNames, error }, status);
  };

  app.get("/tasks", (request, reply) => showPool(request, reply));

  app.post("/tasks", async (request, reply) => {
    const read = readTaskForm(request.body as Form);
    if ("error" in read) return showPool(request, reply, read.error, 400);
    const ownerId = request.owner!._id;
    const { insertedId } = await store.tasks.insertOne({
      ownerId,
      ...read,
      status: "open",
      note: "",
      blockedReason: "",
      listId: null,
      createdAt: ctx.now(),
      updatedAt: ctx.now(),
    });
    await recordEvent(ctx, { ownerId, kind: "task-created", summary: `You created “${read.title}”`, taskId: insertedId });
    return reply.redirect("/assign/tasks", 303);
  });

  app.get("/tasks/:id", async (request, reply) => {
    const task = await findOwnTask(ctx, request.owner!._id, (request.params as { id: string }).id);
    if (!task) return reply.code(404).type("text/plain").send("Not found.");
    const list = task.listId ? await store.lists.findOne({ _id: task.listId }) : null;
    return render(reply, "task", { title: task.title, task, list, error: null });
  });

  app.post("/tasks/:id", async (request, reply) => {
    const task = await findOwnTask(ctx, request.owner!._id, (request.params as { id: string }).id);
    if (!task) return reply.code(404).type("text/plain").send("Not found.");
    const read = readTaskForm(request.body as Form);
    if ("error" in read) return render(reply, "task", { title: task.title, task, list: null, error: read.error }, 400);
    await store.tasks.updateOne({ _id: task._id }, { $set: { ...read, updatedAt: ctx.now() } });
    if (read.title !== task.title || read.instruction !== task.instruction || read.tags.join() !== task.tags.join()) {
      await recordEvent(ctx, {
        ownerId: task.ownerId,
        kind: "task-edited",
        summary: `You edited “${read.title}”`,
        taskId: task._id,
        listId: task.listId,
        from: task.title,
        to: read.title,
      });
    }
    const error = await setNote(ctx, task, field(request.body as Form, "note"), { kind: "owner" });
    if (error) return render(reply, "task", { title: task.title, task, list: null, error }, 400);
    return reply.redirect(`/assign/tasks/${task._id.toHexString()}`, 303);
  });

  app.post("/tasks/:id/status", async (request, reply) => {
    const task = await findOwnTask(ctx, request.owner!._id, (request.params as { id: string }).id);
    if (!task) return reply.code(404).type("text/plain").send("Not found.");
    const form = request.body as Form;
    const error = await setStatus(ctx, task, field(form, "status"), field(form, "reason"), { kind: "owner" });
    if (error) return render(reply, "task", { title: task.title, task, list: null, error }, 400);
    return reply.redirect(`/assign/tasks/${task._id.toHexString()}`, 303);
  });

  app.post("/tasks/:id/delete", async (request, reply) => {
    const task = await findOwnTask(ctx, request.owner!._id, (request.params as { id: string }).id);
    if (!task) return reply.code(404).type("text/plain").send("Not found.");
    await store.tasks.deleteOne({ _id: task._id, ownerId: task.ownerId });
    await recordEvent(ctx, { ownerId: task.ownerId, kind: "task-deleted", summary: `You deleted “${task.title}”`, taskId: task._id, listId: task.listId });
    return reply.redirect("/assign/tasks", 303);
  });
}
```

Register it in `index.ts` inside the Owner scope: `taskRoutes(owner, ctx);`.

- [ ] **Step 5: Write the views**

`src/assign/views/tasks.ejs`:

```html
<%- include("header") %>
<h1>Tasks</h1>
<% if (error) { %><p class="error" role="alert"><%= error %></p><% } %>
<form method="post" action="/assign/tasks" class="card">
  <input type="hidden" name="_csrf" value="<%= csrf %>">
  <label for="title">New Task</label>
  <input type="text" id="title" name="title" maxlength="200" required>
  <label for="tags">Tags <span class="muted">(comma-separated, up to 5)</span></label>
  <input type="text" id="tags" name="tags" list="known-tags">
  <datalist id="known-tags"><% for (const known of allTags) { %><option value="<%= known %>"><% } %></datalist>
  <label for="instruction">Instruction <span class="muted">(what the Assignee should do)</span></label>
  <textarea id="instruction" name="instruction" maxlength="2000" rows="2"></textarea>
  <button class="primary">Add Task</button>
</form>
<p class="muted">Filter: <a href="/assign/tasks"<% if (!tag) { %> aria-current="page"<% } %>>All</a>
<% for (const known of allTags) { %> · <a href="/assign/tasks?tag=<%= encodeURIComponent(known) %>"<% if (tag === known) { %> aria-current="page"<% } %>><%= known %></a><% } %></p>
<form method="post" action="/assign/lists">
  <input type="hidden" name="_csrf" value="<%= csrf %>">
  <% for (const task of tasks) { %>
  <div class="card">
    <% if (!task.listId) { %><input type="checkbox" name="taskIds" value="<%= task._id %>" aria-label="Select <%= task.title %>"><% } %>
    <a href="/assign/tasks/<%= task._id %>"><%= task.title %></a>
    <span class="<%= task.status %>"><%= task.status %></span>
    <% for (const one of task.tags) { %><span class="tag"><%= one %></span><% } %>
    <% if (task.listId) { %><span class="muted">in “<%= listNames[task.listId.toHexString()] %>”</span><% } %>
    <% if (task.status === "blocked") { %><div class="blocked">Blocked: <%= task.blockedReason %></div><% } %>
  </div>
  <% } %>
  <% if (tasks.length === 0) { %><p class="muted">No Tasks yet.</p><% } %>
  <label for="list-name">Make a List of the selected Tasks</label>
  <input type="text" id="list-name" name="name" maxlength="200" placeholder="e.g. Move-out checklist">
  <button>Make List</button>
</form>
<%- include("footer") %>
```

(The "Make List" form posts to Task 4's route; until then it gets a 404, which no test exercises.)

`src/assign/views/task.ejs`:

```html
<%- include("header") %>
<p><a href="/assign/tasks">← Tasks</a></p>
<h1><%= task.title %></h1>
<% if (error) { %><p class="error" role="alert"><%= error %></p><% } %>
<p>Status: <strong class="<%= task.status %>"><%= task.status %></strong>
<% if (list) { %> · in <a href="/assign/lists/<%= list._id %>">“<%= list.name %>”</a><% } %></p>
<% if (task.status === "blocked") { %><p class="blocked">Blocked: <%= task.blockedReason %></p><% } %>
<form method="post" action="/assign/tasks/<%= task._id %>/status" class="card">
  <input type="hidden" name="_csrf" value="<%= csrf %>">
  <button name="status" value="open">Open</button>
  <button name="status" value="done">Done</button>
  <label for="reason">Blocked because</label>
  <input type="text" id="reason" name="reason" maxlength="2000">
  <button name="status" value="blocked">Blocked</button>
</form>
<form method="post" action="/assign/tasks/<%= task._id %>" class="card">
  <input type="hidden" name="_csrf" value="<%= csrf %>">
  <label for="title">Title</label>
  <input type="text" id="title" name="title" value="<%= task.title %>" maxlength="200" required>
  <label for="tags">Tags</label>
  <input type="text" id="tags" name="tags" value="<%= task.tags.join(', ') %>">
  <label for="instruction">Instruction</label>
  <textarea id="instruction" name="instruction" maxlength="2000" rows="3"><%= task.instruction %></textarea>
  <label for="note">Note <span class="muted">(written by the Assignee; you can edit or clear it)</span></label>
  <textarea id="note" name="note" maxlength="2000" rows="3"><%= task.note %></textarea>
  <button class="primary">Save</button>
</form>
<p><a href="/assign/tasks/<%= task._id %>/delete">Delete this Task…</a></p>
<%- include("footer") %>
```

(The "Delete…" link points at Task 9's confirm page. The POST delete route already works.)

- [ ] **Step 6: Run the tests and see them pass**

Run: `npx tsc --noEmit && npx vitest run test/assign`
Expected: PASS.

- [ ] **Step 7: Commit** (tick ticket 03)

```bash
git add src/assign test/assign .scratch/task-assignment/issues/03-tasks-and-tags.md
git commit -m "Task assignment: Tasks and tags (ticket 03)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Lists (ticket 04)

**Files:**
- Create: `src/assign/lists.ts`, `src/assign/views/lists.ejs`, `src/assign/views/list.ejs`
- Modify: `src/assign/index.ts`
- Test: `test/assign/lists.test.ts`

**Interfaces:**
- Consumes: `recordEvent`, `LIMITS`, `findOwnTask`, `render`, `field`, `fields`, `parseId`
- Produces:
  - `findOwnList(ctx, ownerId, id)`
  - `addToList(ctx, list, taskIds): Promise<string | null>`
  - `listRoutes(app, ctx)`
  - `list.ejs` with a `<section id="assign">` slot, which Task 5 fills

- [ ] **Step 1: Write the failing tests**

`test/assign/lists.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { useAssignApp, type Agent } from "./harness.ts";

describe("Task assignment: Lists", () => {
  const t = useAssignApp();

  async function tasks(browser: Agent, ...titles: string[]) {
    for (const title of titles) await browser.post("/assign/tasks", { title });
    const docs = await t.store().tasks.find({ title: { $in: titles } }).toArray();
    return titles.map((title) => docs.find((doc) => doc.title === title)!._id.toHexString());
  }

  async function makeList(browser: Agent, name: string, taskIds: string[]) {
    const reply = await browser.post("/assign/lists", { name, taskIds });
    expect(reply.statusCode).toBe(303);
    return (await t.store().lists.findOne({ name }))!._id.toHexString();
  }

  it("groups selected Tasks into a named draft List, taking them out of the pool", async () => {
    const browser = await t.logIn("sara@example.com");
    const [a, b] = await tasks(browser, "Pack books", "Clean oven", "Fix door");
    const listId = await makeList(browser, "Move-out", [a!, b!]);

    expect(await t.store().lists.findOne({})).toMatchObject({ name: "Move-out", status: "draft" });
    expect((await t.store().tasks.find({ listId: { $ne: null } }).toArray()).map((task) => task.title).sort()).toEqual(["Clean oven", "Pack books"]);
    const page = await browser.get(`/assign/lists/${listId}`);
    expect(page.body).toContain("Pack books");
    expect(page.body).toContain("Draft");
  });

  it("refuses a Task already in another List, naming that List", async () => {
    const browser = await t.logIn("sara@example.com");
    const [a, b] = await tasks(browser, "Pack books", "Clean oven");
    await makeList(browser, "Move-out", [a!]);
    const other = await makeList(browser, "Kitchen", [b!]);

    const refused = await browser.post(`/assign/lists/${other}/tasks`, { taskIds: [a!] });
    expect(refused.statusCode).toBe(409);
    expect(refused.body).toContain("“Pack books” is already in “Move-out”");
    expect((await browser.get(`/assign/lists/${other}`)).body).toContain("in “Move-out”");
  });

  it("returns a removed Task to the pool with its status", async () => {
    const browser = await t.logIn("sara@example.com");
    const [a] = await tasks(browser, "Pack books");
    const listId = await makeList(browser, "Move-out", [a!]);
    await browser.post(`/assign/tasks/${a}/status`, { status: "done" });

    await browser.post(`/assign/lists/${listId}/tasks/${a}/remove`);
    expect(await t.store().tasks.findOne({})).toMatchObject({ listId: null, status: "done" });
  });

  it("holds at most 50 Tasks", async () => {
    const browser = await t.logIn("sara@example.com");
    const ids = await tasks(browser, ...Array.from({ length: 51 }, (_, i) => `Task ${i}`));
    const listId = await makeList(browser, "Big", ids.slice(0, 50));
    const refused = await browser.post(`/assign/lists/${listId}/tasks`, { taskIds: [ids[50]!] });
    expect(refused.statusCode).toBe(400);
    expect(refused.body).toContain("at most 50 Tasks");
  });

  it("needs a name and at least one of the Owner's Tasks", async () => {
    const browser = await t.logIn("sara@example.com");
    const [a] = await tasks(browser, "Pack books");
    expect((await browser.post("/assign/lists", { name: "", taskIds: [a!] })).statusCode).toBe(400);
    expect((await browser.post("/assign/lists", { name: "Empty" })).statusCode).toBe(400);
    const omar = await t.logIn("omar@example.com", t.agent("192.0.2.2"));
    expect((await omar.post("/assign/lists", { name: "Steal", taskIds: [a!] })).statusCode).toBe(400);
    expect(await t.store().lists.countDocuments()).toBe(0);
  });

  it("records List changes as events, and hides Lists from other Owners", async () => {
    const browser = await t.logIn("sara@example.com");
    const [a, b] = await tasks(browser, "Pack books", "Clean oven");
    const listId = await makeList(browser, "Move-out", [a!]);
    await browser.post(`/assign/lists/${listId}/tasks`, { taskIds: [b!] });
    await browser.post(`/assign/lists/${listId}/tasks/${a}/remove`);

    const kinds = (await t.store().events.find({ kind: { $in: ["list-created", "list-changed"] } }).toArray()).map((event) => event.kind);
    expect(kinds).toEqual(["list-created", "list-changed", "list-changed"]);
    const omar = await t.logIn("omar@example.com", t.agent("192.0.2.2"));
    expect((await omar.get(`/assign/lists/${listId}`)).statusCode).toBe(404);
  });
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run test/assign/lists.test.ts`
Expected: FAIL with 404 on `POST /assign/lists`.

- [ ] **Step 3: Write `src/assign/lists.ts`**

```ts
import type { FastifyInstance, FastifyReply } from "fastify";
import type { ObjectId, WithId } from "mongodb";
import type { AssignContext } from "./context.ts";
import { recordEvent } from "./events.ts";
import { field, fields, parseId, render, type Form } from "./http.ts";
import type { ListDoc } from "./store.ts";
import { LIMITS } from "./tasks.ts";

export function findOwnList(ctx: AssignContext, ownerId: ObjectId, id: string | undefined) {
  const _id = parseId(id);
  return _id ? ctx.store.lists.findOne({ _id, ownerId }) : Promise.resolve(null);
}

/** Moves the Owner's Tasks into `list`; an error message (and nothing moved) when one is elsewhere or it would be over 50. */
export async function addToList(ctx: AssignContext, list: WithId<ListDoc>, rawIds: string[]): Promise<{ error: string; status: number } | null> {
  const unique = [...new Set(rawIds)];
  const ids = unique.map(parseId).filter((id): id is ObjectId => id !== null);
  const tasks = await ctx.store.tasks.find({ _id: { $in: ids }, ownerId: list.ownerId }).toArray();
  if (tasks.length === 0 || tasks.length !== unique.length) return { error: "Choose at least one of your Tasks.", status: 400 };
  const elsewhere = tasks.find((task) => task.listId && !task.listId.equals(list._id));
  if (elsewhere) {
    const other = await ctx.store.lists.findOne({ _id: elsewhere.listId! });
    return { error: `“${elsewhere.title}” is already in “${other?.name ?? "another List"}”.`, status: 409 };
  }
  const fresh = tasks.filter((task) => !task.listId);
  const already = await ctx.store.tasks.countDocuments({ listId: list._id });
  if (already + fresh.length > LIMITS.tasksPerList) return { error: `A List holds at most ${LIMITS.tasksPerList} Tasks.`, status: 400 };
  const moved = await ctx.store.tasks.updateMany(
    { _id: { $in: fresh.map((task) => task._id) }, ownerId: list.ownerId, listId: null },
    { $set: { listId: list._id, updatedAt: ctx.now() } },
  );
  if (moved.modifiedCount !== fresh.length) return { error: "Some of those Tasks just changed. Try again.", status: 409 };
  return null;
}

/** Lists, under `/assign`, behind login. */
export function listRoutes(app: FastifyInstance, ctx: AssignContext) {
  const { store } = ctx;

  const showList = async (reply: FastifyReply, list: WithId<ListDoc>, error: string | null = null, status = 200) => {
    const tasks = await store.tasks.find({ listId: list._id }).sort({ createdAt: 1 }).toArray();
    const others = await store.tasks.find({ ownerId: list.ownerId, listId: { $ne: list._id } }).sort({ createdAt: -1 }).toArray();
    const lists = await store.lists.find({ ownerId: list.ownerId }).toArray();
    const listNames = Object.fromEntries(lists.map((one) => [one._id.toHexString(), one.name]));
    const assignment = await store.assignments.findOne({ listId: list._id, active: true });
    const person = assignment ? await store.people.findOne({ _id: assignment.personId }) : null;
    const people = await store.people.find({ ownerId: list.ownerId }).sort({ nameLower: 1 }).toArray();
    return render(
      reply,
      "list",
      { title: list.name, list, tasks, others, listNames, assignment, person, people, publicUrl: ctx.config.publicUrl, error },
      status,
    );
  };

  app.get("/lists", async (request, reply) => {
    const ownerId = request.owner!._id;
    const lists = await store.lists.find({ ownerId }).sort({ createdAt: -1 }).toArray();
    const counts = await store.tasks
      .aggregate<{ _id: ObjectId; total: number; done: number }>([
        { $match: { ownerId, listId: { $ne: null } } },
        { $group: { _id: "$listId", total: { $sum: 1 }, done: { $sum: { $cond: [{ $eq: ["$status", "done"] }, 1, 0] } } } },
      ])
      .toArray();
    const progress = Object.fromEntries(counts.map((count) => [count._id.toHexString(), count]));
    return render(reply, "lists", { title: "Lists", lists, progress });
  });

  app.post("/lists", async (request, reply) => {
    const ownerId = request.owner!._id;
    const form = request.body as Form;
    const name = field(form, "name");
    const taskIds = [...new Set(fields(form, "taskIds"))];
    const refuse = (message: string) => reply.code(400).type("text/plain").send(message);
    if (!name) return refuse("Give the List a name.");
    if (name.length > LIMITS.title) return refuse(`List names can be at most ${LIMITS.title} characters.`);
    const owned = await store.tasks.countDocuments({ ownerId, _id: { $in: taskIds.map(parseId).filter((id) => id !== null) } });
    if (taskIds.length === 0 || owned !== taskIds.length) return refuse("Choose at least one of your Tasks.");

    const { insertedId } = await store.lists.insertOne({ ownerId, name, status: "draft", createdAt: ctx.now() });
    const list = (await store.lists.findOne({ _id: insertedId }))!;
    const problem = await addToList(ctx, list, taskIds);
    if (problem) {
      await store.lists.deleteOne({ _id: insertedId });
      return reply.code(problem.status).type("text/plain").send(problem.error);
    }
    await recordEvent(ctx, { ownerId, kind: "list-created", summary: `You made the List “${name}”`, listId: insertedId });
    return reply.redirect(`/assign/lists/${insertedId.toHexString()}`, 303);
  });

  app.get("/lists/:id", async (request, reply) => {
    const list = await findOwnList(ctx, request.owner!._id, (request.params as { id: string }).id);
    return list ? showList(reply, list) : reply.code(404).type("text/plain").send("Not found.");
  });

  app.post("/lists/:id/tasks", async (request, reply) => {
    const list = await findOwnList(ctx, request.owner!._id, (request.params as { id: string }).id);
    if (!list) return reply.code(404).type("text/plain").send("Not found.");
    const problem = await addToList(ctx, list, fields(request.body as Form, "taskIds"));
    if (problem) return showList(reply, list, problem.error, problem.status);
    await recordEvent(ctx, { ownerId: list.ownerId, kind: "list-changed", summary: `You added Tasks to “${list.name}”`, listId: list._id });
    return reply.redirect(`/assign/lists/${list._id.toHexString()}`, 303);
  });

  app.post("/lists/:id/tasks/:taskId/remove", async (request, reply) => {
    const params = request.params as { id: string; taskId: string };
    const list = await findOwnList(ctx, request.owner!._id, params.id);
    const taskId = parseId(params.taskId);
    if (!list || !taskId) return reply.code(404).type("text/plain").send("Not found.");
    const task = await store.tasks.findOneAndUpdate(
      { _id: taskId, ownerId: list.ownerId, listId: list._id },
      { $set: { listId: null, updatedAt: ctx.now() } },
    );
    if (!task) return reply.code(404).type("text/plain").send("Not found.");
    await recordEvent(ctx, {
      ownerId: list.ownerId,
      kind: "list-changed",
      summary: `You took “${task.title}” out of “${list.name}”`,
      listId: list._id,
      taskId: task._id,
    });
    return reply.redirect(`/assign/lists/${list._id.toHexString()}`, 303);
  });
}
```

Register `listRoutes(owner, ctx);` in `index.ts`.

- [ ] **Step 4: Write the views**

`src/assign/views/lists.ejs`:

```html
<%- include("header") %>
<h1>Lists</h1>
<p class="muted">Make a List by selecting Tasks on the <a href="/assign/tasks">Tasks</a> page.</p>
<% for (const list of lists) { const p = progress[list._id.toHexString()] || { total: 0, done: 0 }; %>
<div class="card"><a href="/assign/lists/<%= list._id %>"><%= list.name %></a>
  <span class="muted"><%= list.status === "draft" ? "Draft" : "Assigned" %> · <%= p.done %> of <%= p.total %> done</span></div>
<% } %>
<% if (lists.length === 0) { %><p class="muted">No Lists yet.</p><% } %>
<%- include("footer") %>
```

`src/assign/views/list.ejs`:

```html
<%- include("header") %>
<p><a href="/assign/lists">← Lists</a></p>
<h1><%= list.name %></h1>
<% if (error) { %><p class="error" role="alert"><%= error %></p><% } %>
<p class="muted"><%= list.status === "draft" ? "Draft: not assigned yet" : "Assigned" %></p>
<section id="assign"></section>
<h2>Tasks (<%= tasks.length %>)</h2>
<% for (const task of tasks) { %>
<div class="card">
  <a href="/assign/tasks/<%= task._id %>"><%= task.title %></a> <span class="<%= task.status %>"><%= task.status %></span>
  <form method="post" action="/assign/lists/<%= list._id %>/tasks/<%= task._id %>/remove" class="inline">
    <input type="hidden" name="_csrf" value="<%= csrf %>"><button>Remove</button>
  </form>
</div>
<% } %>
<h2>Add Tasks</h2>
<form method="post" action="/assign/lists/<%= list._id %>/tasks">
  <input type="hidden" name="_csrf" value="<%= csrf %>">
  <% for (const task of others) { %>
  <div>
    <% if (task.listId) { %>
    <span class="muted"><%= task.title %> (in “<%= listNames[task.listId.toHexString()] %>”)</span>
    <% } else { %>
    <label><input type="checkbox" name="taskIds" value="<%= task._id %>"> <%= task.title %></label>
    <% } %>
  </div>
  <% } %>
  <button>Add selected</button>
</form>
<p><a href="/assign/lists/<%= list._id %>/delete">Delete this List…</a></p>
<%- include("footer") %>
```

- [ ] **Step 5: Run the tests and see them pass**

Run: `npx tsc --noEmit && npx vitest run test/assign`
Expected: PASS.

- [ ] **Step 6: Commit** (tick ticket 04)

```bash
git add src/assign test/assign .scratch/task-assignment/issues/04-lists.md
git commit -m "Task assignment: Lists (ticket 04)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: People, assigning and the link page (ticket 05)

**Files:**
- Create: `src/assign/assignments.ts`, `src/assign/link.ts`, `src/assign/views/link.ejs`, `src/assign/views/link-gone.ejs`
- Modify: `src/assign/crypto.ts`, `src/assign/index.ts`, `src/assign/views/list.ejs`
- Test: `test/assign/assign.test.ts`

**Interfaces:**
- Consumes: `findOwnList`, `setStatus`, `setNote`, `recordEvent`, `render`
- Produces:
  - `randomCode(length = 10): string`
  - `revokeAssignment(ctx, assignment, why: "revoked" | "reassigned" | "deleted"): Promise<void>`, which records a `revoked` event carrying `assignmentId` and `listId`
  - `activeAssignment(ctx, code)`
  - `assignmentRoutes(app, ctx)`
  - `linkRoutes(app, ctx)`
  - `LINK_LOG_SERIALIZERS`

- [ ] **Step 1: Write the failing tests**

`test/assign/assign.test.ts`:

```ts
import { Writable } from "node:stream";
import { ObjectId } from "mongodb";
import { describe, expect, it } from "vitest";
import { useAssignApp, type Agent } from "./harness.ts";

/** Makes a List of the given Tasks for `browser` and returns its ID. */
async function listOf(t: ReturnType<typeof useAssignApp>, browser: Agent, name: string, titles: string[]) {
  for (const title of titles) await browser.post("/assign/tasks", { title, instruction: `Do ${title}` });
  const ids = (await t.store().tasks.find({ title: { $in: titles } }).toArray()).map((task) => task._id.toHexString());
  await browser.post("/assign/lists", { name, taskIds: ids });
  return (await t.store().lists.findOne({ name }))!._id.toHexString();
}

/** Assigns the List and returns its new link code. */
async function assign(t: ReturnType<typeof useAssignApp>, browser: Agent, listId: string, person: string) {
  const reply = await browser.post(`/assign/lists/${listId}/assign`, { person });
  expect(reply.statusCode).toBe(303);
  return (await t.store().assignments.findOne({ listId: new ObjectId(listId), active: true }))!.code;
}

describe("Task assignment: assigning a List", () => {
  const t = useAssignApp();

  it("assigns a List to a Person with an unguessable link shown with a copy button", async () => {
    const browser = await t.logIn("sara@example.com");
    const listId = await listOf(t, browser, "Move-out", ["Pack books"]);
    const code = await assign(t, browser, listId, "Omar");

    expect(code).toMatch(/^[A-Za-z0-9]{10}$/);
    expect(await t.store().lists.findOne({})).toMatchObject({ status: "active" });
    const page = await browser.get(`/assign/lists/${listId}`);
    expect(page.body).toContain(`http://assign.test/l/${code}`);
    expect(page.body).toContain("Copy link");
    expect(page.body).toContain("Omar");
  });

  it("reuses a Person whatever the case of the name", async () => {
    const browser = await t.logIn("sara@example.com");
    const first = await listOf(t, browser, "One", ["A"]);
    const second = await listOf(t, browser, "Two", ["B"]);
    await assign(t, browser, first, "Omar");
    await assign(t, browser, second, "  omar ");
    expect(await t.store().people.countDocuments()).toBe(1);
    expect((await t.store().people.findOne({}))!.name).toBe("Omar");
  });

  it("keeps one live link when Assign is posted twice at once", async () => {
    const browser = await t.logIn("sara@example.com");
    const listId = await listOf(t, browser, "Move-out", ["Pack books"]);
    await Promise.all([
      browser.post(`/assign/lists/${listId}/assign`, { person: "Omar" }),
      browser.post(`/assign/lists/${listId}/assign`, { person: "Omar" }),
    ]);
    expect(await t.store().assignments.countDocuments({ active: true })).toBe(1);
  });

  it("reassigns: the old link stops working, statuses carry over", async () => {
    const browser = await t.logIn("sara@example.com");
    const listId = await listOf(t, browser, "Move-out", ["Pack books"]);
    const old = await assign(t, browser, listId, "Omar");
    await t.agent().post(`/l/${old}/tasks/${(await t.store().tasks.findOne({}))!._id}/status`, { status: "done" });

    await browser.post(`/assign/lists/${listId}/assign`, { person: "Lina" });
    const fresh = (await t.store().assignments.findOne({ active: true }))!.code;
    expect(fresh).not.toBe(old);
    const gone = await t.agent().get(`/l/${old}`);
    expect(gone.statusCode).toBe(404);
    expect(gone.body).toContain("no longer available");
    expect((await t.agent().get(`/l/${fresh}`)).body).toContain("Done (1)");
  });

  it("revokes a link, putting the List back to draft", async () => {
    const browser = await t.logIn("sara@example.com");
    const listId = await listOf(t, browser, "Move-out", ["Pack books"]);
    const code = await assign(t, browser, listId, "Omar");
    await browser.post(`/assign/lists/${listId}/revoke`);
    expect((await t.agent().get(`/l/${code}`)).statusCode).toBe(404);
    expect(await t.store().lists.findOne({})).toMatchObject({ status: "draft" });
    expect((await t.store().events.find({ kind: "revoked" }).toArray())).toHaveLength(1);
  });
});

describe("Task assignment: the link page", () => {
  const t = useAssignApp();

  it("shows the List, who it's for and its Tasks, with no login, cookies or indexing", async () => {
    const browser = await t.logIn("sara@example.com");
    const listId = await listOf(t, browser, "Move-out", ["Pack books", "Clean oven"]);
    await browser.post("/assign/tasks", { title: "Not in the List" });
    const code = await assign(t, browser, listId, "Omar");

    const page = await t.agent("198.51.100.20").get(`/l/${code}`);
    expect(page.statusCode).toBe(200);
    expect(page.headers["x-robots-tag"]).toBe("noindex, nofollow");
    expect(page.headers["referrer-policy"]).toBe("no-referrer");
    expect(page.headers["set-cookie"]).toBeUndefined();
    expect(page.body).toContain('<meta name="robots" content="noindex, nofollow">');
    expect(page.body).toContain("Move-out");
    expect(page.body).toContain("For Omar");
    expect(page.body).toContain("Do Pack books");
    expect(page.body).not.toContain("Not in the List");
  });

  it("lets the Assignee mark done, blocked with a reason, open, and leave a note", async () => {
    const browser = await t.logIn("sara@example.com");
    const listId = await listOf(t, browser, "Move-out", ["Pack books"]);
    const code = await assign(t, browser, listId, "Omar");
    const taskId = (await t.store().tasks.findOne({}))!._id.toHexString();
    const assignee = t.agent("198.51.100.20");

    expect((await assignee.post(`/l/${code}/tasks/${taskId}/status`, { status: "blocked" })).statusCode).toBe(400);
    expect((await assignee.post(`/l/${code}/tasks/${taskId}/status`, { status: "blocked", reason: "No tape" })).statusCode).toBe(303);
    expect(await t.store().tasks.findOne({})).toMatchObject({ status: "blocked", blockedReason: "No tape" });
    await assignee.post(`/l/${code}/tasks/${taskId}/note`, { note: "Bought tape" });
    await assignee.post(`/l/${code}/tasks/${taskId}/status`, { status: "done" });
    expect(await t.store().tasks.findOne({})).toMatchObject({ status: "done", note: "Bought tape", blockedReason: "" });
    const page = await assignee.get(`/l/${code}`);
    expect(page.body).toMatch(/<details>\s*<summary>Done \(1\)<\/summary>/);

    const events = await t.store().events.find({ actor: "assignee" }).toArray();
    expect(events.map((event) => event.summary)).toContain("Omar marked “Pack books” blocked: No tape");
  });

  it("refuses Tasks outside the List, and every other change", async () => {
    const browser = await t.logIn("sara@example.com");
    const listId = await listOf(t, browser, "Move-out", ["Pack books"]);
    await browser.post("/assign/tasks", { title: "Elsewhere" });
    const elsewhere = (await t.store().tasks.findOne({ title: "Elsewhere" }))!._id.toHexString();
    const code = await assign(t, browser, listId, "Omar");
    const assignee = t.agent("198.51.100.20");

    expect((await assignee.post(`/l/${code}/tasks/${elsewhere}/status`, { status: "done" })).statusCode).toBe(404);
    const inList = (await t.store().tasks.findOne({ title: "Pack books" }))!._id.toHexString();
    await browser.post(`/assign/lists/${listId}/tasks/${inList}/remove`);
    expect((await assignee.post(`/l/${code}/tasks/${inList}/status`, { status: "done" })).statusCode).toBe(404);
    expect((await assignee.post(`/l/${code}/tasks/${inList}`, { title: "Renamed" })).statusCode).toBe(404);
    expect((await assignee.post(`/l/${code}/tasks`, { title: "New" })).statusCode).toBe(404);
    expect(await t.store().tasks.countDocuments({ status: "done" })).toBe(0);
  });

  it("allows 60 link requests per minute per IP", async () => {
    const browser = await t.logIn("sara@example.com");
    const listId = await listOf(t, browser, "Move-out", ["Pack books"]);
    const code = await assign(t, browser, listId, "Omar");
    const assignee = t.agent("198.51.100.30");
    for (let i = 0; i < 60; i++) expect((await assignee.get(`/l/${code}`)).statusCode).toBe(200);
    expect((await assignee.get(`/l/${code}`)).statusCode).toBe(429);
    t.clock.advance(60_001);
    expect((await assignee.get(`/l/${code}`)).statusCode).toBe(200);
  });
});

describe("Task assignment: link codes stay out of the log", () => {
  let logged = "";
  const t = useAssignApp({
    logStream: new Writable({
      write(chunk, _encoding, done) {
        logged += chunk;
        done();
      },
    }),
  });

  it("never writes a link code to the server log", async () => {
    const browser = await t.logIn("sara@example.com");
    const listId = await listOf(t, browser, "Move-out", ["Pack books"]);
    const code = await assign(t, browser, listId, "Omar");
    logged = "";
    await t.agent().get(`/l/${code}`);
    await t.agent().post(`/l/${code}/tasks/${(await t.store().tasks.findOne({}))!._id}/status`, { status: "done" });
    await t.agent().get("/l/doesnotexist");
    expect(logged).not.toContain(code);
    expect(logged).not.toContain("doesnotexist");
  });
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run test/assign/assign.test.ts`
Expected: FAIL with 404 on `/assign/lists/:id/assign`.

- [ ] **Step 3: Add `randomCode` to `src/assign/crypto.ts`**

```ts
const CODE_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

/** An unguessable link code: `length` characters from 62, without modulo bias (62^10 ≈ 8·10^17). */
export function randomCode(length = 10): string {
  let code = "";
  while (code.length < length) {
    for (const byte of randomBytes(length * 2)) {
      if (byte < 248 && code.length < length) code += CODE_ALPHABET[byte % 62];
    }
  }
  return code;
}
```

- [ ] **Step 4: Write `src/assign/assignments.ts`**

```ts
import type { FastifyInstance } from "fastify";
import type { ObjectId, WithId } from "mongodb";
import type { AssignContext } from "./context.ts";
import { randomCode } from "./crypto.ts";
import { recordEvent } from "./events.ts";
import { field, type Form } from "./http.ts";
import { findOwnList } from "./lists.ts";
import type { AssignmentDoc, PersonDoc } from "./store.ts";
import { LIMITS } from "./tasks.ts";

/** Ends an Assignment: its link stops working and open link pages are told (Task 8). */
export async function revokeAssignment(ctx: AssignContext, assignment: WithId<AssignmentDoc>, why: "revoked" | "reassigned" | "deleted") {
  const ended = await ctx.store.assignments.findOneAndUpdate(
    { _id: assignment._id, active: true },
    { $set: { active: false, revokedAt: ctx.now() } },
  );
  if (!ended) return;
  const list = await ctx.store.lists.findOne({ _id: assignment.listId });
  const person = await ctx.store.people.findOne({ _id: assignment.personId });
  await recordEvent(ctx, {
    ownerId: assignment.ownerId,
    kind: "revoked",
    summary: `${person?.name ?? "Someone"}'s link to “${list?.name ?? "a List"}” was ${why === "reassigned" ? "replaced" : "revoked"}`,
    listId: assignment.listId,
    personId: assignment.personId,
    assignmentId: assignment._id,
  });
}

const isDuplicateKey = (error: unknown) =>
  error instanceof Error && "code" in error && (error as { code: unknown }).code === 11000;

/** The Owner's Person with this name, ignoring case, created if new. Two requests at once can race the
 * upsert into a duplicate-key error; the loser then reads the winner's. */
async function personNamed(ctx: AssignContext, ownerId: ObjectId, name: string): Promise<WithId<PersonDoc>> {
  const nameLower = name.toLowerCase();
  try {
    return (await ctx.store.people.findOneAndUpdate(
      { ownerId, nameLower },
      { $setOnInsert: { ownerId, name, nameLower, createdAt: ctx.now() } },
      { upsert: true, returnDocument: "after" },
    ))!;
  } catch (error) {
    if (!isDuplicateKey(error)) throw error;
    return (await ctx.store.people.findOne({ ownerId, nameLower }))!;
  }
}

export function activeAssignment(ctx: AssignContext, code: string) {
  return /^[A-Za-z0-9]{10}$/.test(code) ? ctx.store.assignments.findOne({ code, active: true }) : Promise.resolve(null);
}

/** Assigning, reassigning and revoking, under `/assign`, behind login. */
export function assignmentRoutes(app: FastifyInstance, ctx: AssignContext) {
  const { store } = ctx;

  app.post("/lists/:id/assign", async (request, reply) => {
    const list = await findOwnList(ctx, request.owner!._id, (request.params as { id: string }).id);
    if (!list) return reply.code(404).type("text/plain").send("Not found.");
    const name = field(request.body as Form, "person").replace(/\s+/g, " ");
    if (!name) return reply.code(400).type("text/plain").send("Say who it's for.");
    if (name.length > LIMITS.title) return reply.code(400).type("text/plain").send(`Names can be at most ${LIMITS.title} characters.`);

    const person = await personNamed(ctx, list.ownerId, name);
    const current = await store.assignments.findOne({ listId: list._id, active: true });
    if (current) await revokeAssignment(ctx, current, "reassigned");

    const assignment: AssignmentDoc = {
      ownerId: list.ownerId,
      listId: list._id,
      personId: person._id,
      code: randomCode(),
      active: true,
      createdAt: ctx.now(),
      revokedAt: null,
      firstViewedAt: null,
      lastViewedAt: null,
      viewCount: 0,
    };
    try {
      const { insertedId } = await store.assignments.insertOne(assignment);
      await store.lists.updateOne({ _id: list._id }, { $set: { status: "active" } });
      await recordEvent(ctx, {
        ownerId: list.ownerId,
        kind: "assigned",
        summary: `You assigned “${list.name}” to ${person.name}`,
        listId: list._id,
        personId: person._id,
        assignmentId: insertedId,
      });
    } catch (error) {
      // A second Assign racing this one already holds the List's one live link (unique partial index).
      if (!isDuplicateKey(error)) throw error;
    }
    return reply.redirect(`/assign/lists/${list._id.toHexString()}`, 303);
  });

  app.post("/lists/:id/revoke", async (request, reply) => {
    const list = await findOwnList(ctx, request.owner!._id, (request.params as { id: string }).id);
    if (!list) return reply.code(404).type("text/plain").send("Not found.");
    const current = await store.assignments.findOne({ listId: list._id, active: true });
    if (current) await revokeAssignment(ctx, current, "revoked");
    await store.lists.updateOne({ _id: list._id }, { $set: { status: "draft" } });
    return reply.redirect(`/assign/lists/${list._id.toHexString()}`, 303);
  });
}
```

Register `assignmentRoutes(owner, ctx);` in the Owner scope.

- [ ] **Step 5: Write `src/assign/link.ts`**

```ts
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { WithId } from "mongodb";
import { activeAssignment } from "./assignments.ts";
import type { AssignContext } from "./context.ts";
import { field, parseId, render, type Form } from "./http.ts";
import type { AssignmentDoc } from "./store.ts";
import { setNote, setStatus } from "./tasks.ts";

/** Request logs for `/l` routes with the code replaced: the code is the Assignee's only credential. */
export const LINK_LOG_SERIALIZERS = {
  req(request: { method: string; url: string }) {
    return { method: request.method, url: request.url.replace(/^\/l\/[^/?#]*/, "/l/[code]") };
  },
};

function noIndex(reply: FastifyReply) {
  reply.header("x-robots-tag", "noindex, nofollow").header("referrer-policy", "no-referrer").header("cache-control", "no-store");
}

/** The Assignee's link page and its actions, under `/l`. No cookies are read or set. */
export function linkRoutes(app: FastifyInstance, ctx: AssignContext) {
  const { store } = ctx;

  app.addHook("onRequest", async (request, reply) => {
    noIndex(reply);
    if (!ctx.limiter.allow(`l:${request.ip}`, 60, 60_000)) {
      return reply.code(429).type("text/plain").send("Too many requests. Wait a minute and try again.");
    }
  });

  const gone = (reply: FastifyReply) =>
    render(reply, "link-gone", { title: "No longer available", noindex: true }, 404);

  const withAssignment = async (request: FastifyRequest): Promise<WithId<AssignmentDoc> | null> =>
    activeAssignment(ctx, (request.params as { code: string }).code);

  app.get("/:code", async (request, reply) => {
    const assignment = await withAssignment(request);
    if (!assignment) return gone(reply);
    const list = (await store.lists.findOne({ _id: assignment.listId }))!;
    const person = (await store.people.findOne({ _id: assignment.personId }))!;
    const tasks = await store.tasks.find({ listId: list._id, ownerId: assignment.ownerId }).sort({ createdAt: 1 }).toArray();
    return render(reply, "link", {
      title: list.name,
      list,
      person,
      code: assignment.code,
      open: tasks.filter((task) => task.status !== "done"),
      done: tasks.filter((task) => task.status === "done"),
      noindex: true,
      stream: `/l/${assignment.code}/events`,
      error: (request.query as { error?: string }).error ?? null,
    });
  });

  /** The Task, only if it is in this Assignment's List right now. */
  const taskOf = async (request: FastifyRequest, assignment: WithId<AssignmentDoc>) => {
    const _id = parseId((request.params as { taskId: string }).taskId);
    return _id ? store.tasks.findOne({ _id, ownerId: assignment.ownerId, listId: assignment.listId }) : null;
  };

  const act = (change: "status" | "note") => async (request: FastifyRequest, reply: FastifyReply) => {
    const assignment = await withAssignment(request);
    if (!assignment) return gone(reply);
    const task = await taskOf(request, assignment);
    if (!task) return reply.code(404).type("text/plain").send("That Task isn't on this List.");
    const person = (await store.people.findOne({ _id: assignment.personId }))!;
    const actor = { kind: "assignee" as const, name: person.name, personId: person._id };
    const form = request.body as Form;
    const error =
      change === "status"
        ? await setStatus(ctx, task, field(form, "status"), field(form, "reason"), actor)
        : await setNote(ctx, task, field(form, "note"), actor);
    if (error) return reply.code(400).type("text/plain").send(error);
    return reply.redirect(`/l/${assignment.code}`, 303);
  };

  app.post("/:code/tasks/:taskId/status", act("status"));
  app.post("/:code/tasks/:taskId/note", act("note"));
}
```

In `index.ts`, register the link scope with request logging silenced and the code redacted from any log line that does carry the request:

```ts
  await app.register(
    async (link) => {
      linkRoutes(link, ctx);
    },
    { prefix: "/l", logLevel: "warn", logSerializers: LINK_LOG_SERIALIZERS },
  );
```

`logLevel: "warn"` drops Fastify's per-request "incoming request" and "request completed" lines for these routes. `logSerializers` covers error lines, which still include the request. If `register` doesn't accept `logLevel` in this Fastify version, pass `{ logLevel: "warn" }` as the options of each `link.get`/`link.post` route instead. The test decides.

- [ ] **Step 6: Write the views**

`src/assign/views/link.ejs`:

```html
<%- include("header") %>
<h1><%= list.name %></h1>
<p class="muted">For <%= person.name %></p>
<% const card = (task) => { %>
<div class="card" id="task-<%= task._id %>">
  <strong><%= task.title %></strong> <span class="<%= task.status %>"><%= task.status %></span>
  <% for (const one of task.tags) { %><span class="tag"><%= one %></span><% } %>
  <% if (task.instruction) { %><p><%= task.instruction %></p><% } %>
  <% if (task.status === "blocked") { %><p class="blocked">Blocked: <%= task.blockedReason %></p><% } %>
  <form method="post" action="/l/<%= code %>/tasks/<%= task._id %>/status">
    <% if (task.status !== "done") { %><button name="status" value="done" class="primary">Done</button><% } %>
    <% if (task.status !== "open") { %><button name="status" value="open">Open again</button><% } %>
    <% if (task.status !== "done") { %>
    <label for="reason-<%= task._id %>">Stuck? Say why</label>
    <input type="text" id="reason-<%= task._id %>" name="reason" maxlength="2000">
    <button name="status" value="blocked">Blocked</button>
    <% } %>
  </form>
  <form method="post" action="/l/<%= code %>/tasks/<%= task._id %>/note">
    <label for="note-<%= task._id %>">Note</label>
    <textarea id="note-<%= task._id %>" name="note" maxlength="2000" rows="2"><%= task.note %></textarea>
    <button>Save note</button>
  </form>
</div>
<% } %>
<% for (const task of open) card(task); %>
<% if (open.length === 0) { %><p class="done">All done. Thank you!</p><% } %>
<% if (done.length > 0) { %>
<details>
<summary>Done (<%= done.length %>)</summary>
<% for (const task of done) card(task); %>
</details>
<% } %>
<%- include("footer") %>
```

`src/assign/views/link-gone.ejs`:

```html
<%- include("header") %>
<h1>This list is no longer available</h1>
<p>Ask the person who sent it for a new link.</p>
<%- include("footer") %>
```

In `src/assign/views/list.ejs`, replace `<section id="assign"></section>` with:

```html
<section id="assign" class="card">
  <% if (assignment) { %>
  <p>Assigned to <strong><%= person.name %></strong>.
     <% if (assignment.firstViewedAt) { %>Viewed <time datetime="<%= assignment.lastViewedAt.toISOString() %>"></time><% } else { %>Not opened<% } %></p>
  <input type="text" id="link" readonly value="<%= publicUrl %>/l/<%= assignment.code %>">
  <button type="button" onclick="navigator.clipboard.writeText(document.getElementById('link').value).then(() => this.textContent = 'Copied')">Copy link</button>
  <form method="post" action="/assign/lists/<%= list._id %>/revoke" class="inline">
    <input type="hidden" name="_csrf" value="<%= csrf %>"><button>Revoke link</button>
  </form>
  <% } %>
  <form method="post" action="/assign/lists/<%= list._id %>/assign">
    <input type="hidden" name="_csrf" value="<%= csrf %>">
    <label for="person"><%= assignment ? "Reassign to" : "Assign to" %></label>
    <input type="text" id="person" name="person" list="people" maxlength="200" required>
    <datalist id="people"><% for (const one of people) { %><option value="<%= one.name %>"><% } %></datalist>
    <button class="primary"><%= assignment ? "Reassign" : "Assign" %></button>
  </form>
</section>
```

- [ ] **Step 7: Run the tests and see them pass**

Run: `npx tsc --noEmit && npx vitest run test/assign`
Expected: PASS. If the log test fails because `register` ignored `logLevel`, move it onto each route as described in Step 5 and rerun.

- [ ] **Step 8: Commit** (tick ticket 05)

```bash
git add src/assign test/assign .scratch/task-assignment/issues/05-assign-and-link-page.md
git commit -m "Task assignment: People, assigning and the link page (ticket 05)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Viewed tracking (ticket 06)

**Files:**
- Create: `src/assign/user-agent.ts`
- Modify: `src/assign/link.ts`, `src/assign/views/link.ejs`
- Test: `test/assign/views.test.ts`

**Interfaces:**
- Consumes: `activeAssignment`, `ownerFromAccess` (from `auth.ts`), `recordEvent`
- Produces:
  - `isBot(userAgent): boolean`
  - `browserOf(userAgent): string`
  - `deviceTypeOf(userAgent): ViewDoc["deviceType"]`
  - `POST /l/:code/view` → 204

- [ ] **Step 1: Write the failing tests**

`test/assign/views.test.ts`:

```ts
import { ObjectId } from "mongodb";
import { describe, expect, it } from "vitest";
import { useAssignApp } from "./harness.ts";

const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const CHROME = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

describe("Task assignment: viewed tracking", () => {
  const t = useAssignApp();

  async function assigned() {
    const owner = await t.logIn("sara@example.com");
    await owner.post("/assign/tasks", { title: "Pack books" });
    await owner.post("/assign/lists", { name: "Move-out", taskIds: [(await t.store().tasks.findOne({}))!._id.toHexString()] });
    const listId = (await t.store().lists.findOne({}))!._id.toHexString();
    await owner.post(`/assign/lists/${listId}/assign`, { person: "Omar" });
    return { owner, listId, code: (await t.store().assignments.findOne({ active: true }))!.code };
  }

  const beacon = (code: string, userAgent: string, cookie = "") =>
    t.app().inject({ method: "POST", url: `/l/${code}/view`, remoteAddress: "198.51.100.5", headers: { "user-agent": userAgent, cookie } });

  it("counts nothing on render, and the beacon counts once with one opened event", async () => {
    const { code } = await assigned();
    await t.agent().get(`/l/${code}`, { "user-agent": IPHONE });
    expect((await t.store().assignments.findOne({}))!.viewCount).toBe(0);

    expect((await beacon(code, IPHONE)).statusCode).toBe(204);
    t.clock.advance(5 * 60_000);
    await beacon(code, CHROME);
    const assignment = (await t.store().assignments.findOne({}))!;
    expect(assignment.viewCount).toBe(2);
    expect(assignment.firstViewedAt).toEqual(new Date("2026-11-12T09:00:00Z"));
    expect(assignment.lastViewedAt).toEqual(new Date("2026-11-12T09:05:00Z"));
    const opened = await t.store().events.find({ kind: "opened" }).toArray();
    expect(opened.map((event) => event.summary)).toEqual(["Omar opened “Move-out”"]);
  });

  it.each([
    "WhatsApp/2.23.20.0",
    "TelegramBot (like TwitterBot)",
    "Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)",
    "facebookexternalhit/1.1",
    "Mozilla/5.0 (compatible; Discordbot/2.0)",
    "",
  ])("logs but doesn't count a link preview or bot: %j", async (userAgent) => {
    const { code } = await assigned();
    await beacon(code, userAgent);
    expect((await t.store().assignments.findOne({}))!.viewCount).toBe(0);
    expect(await t.store().views.findOne({})).toMatchObject({ counted: false });
    expect(await t.store().events.countDocuments({ kind: "opened" })).toBe(0);
  });

  it("doesn't count the Owner's own visit", async () => {
    const { owner, code } = await assigned();
    await beacon(code, CHROME, owner.cookieHeader());
    expect((await t.store().assignments.findOne({}))!.viewCount).toBe(0);
    expect(await t.store().views.findOne({})).toMatchObject({ counted: false });
  });

  it("writes exactly one opened event when two first views race", async () => {
    const { code } = await assigned();
    await Promise.all([beacon(code, IPHONE), beacon(code, CHROME)]);
    expect((await t.store().assignments.findOne({}))!.viewCount).toBe(2);
    expect(await t.store().events.countDocuments({ kind: "opened" })).toBe(1);
  });

  it("logs time, user agent, browser and device type, and no IP", async () => {
    const { code } = await assigned();
    await beacon(code, IPHONE);
    const view = (await t.store().views.findOne({}, { projection: { _id: 0 } }))!;
    expect(view).toEqual({
      ownerId: expect.any(ObjectId),
      assignmentId: expect.any(ObjectId),
      viewedAt: new Date("2026-11-12T09:00:00Z"),
      userAgent: IPHONE,
      browser: "Safari",
      deviceType: "mobile",
      counted: true,
      outcome: "ok",
    });
    expect(JSON.stringify(view)).not.toContain("198.51.100.5");
  });

  it("starts a reassigned List as Not opened, keeping the old views", async () => {
    const { owner, listId, code } = await assigned();
    await beacon(code, IPHONE);
    await owner.post(`/assign/lists/${listId}/assign`, { person: "Lina" });
    const fresh = (await t.store().assignments.findOne({ active: true }))!;
    expect(fresh).toMatchObject({ viewCount: 0, firstViewedAt: null });
    expect(await t.store().views.countDocuments()).toBe(1);
    expect((await owner.get(`/assign/lists/${listId}`)).body).toContain("Not opened");
  });

  it("answers a beacon for a revoked link with 404, counting nothing", async () => {
    const { owner, listId, code } = await assigned();
    await owner.post(`/assign/lists/${listId}/revoke`);
    expect((await beacon(code, IPHONE)).statusCode).toBe(404);
    expect(await t.store().views.countDocuments()).toBe(0);
  });
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run test/assign/views.test.ts`
Expected: FAIL with 404 on `POST /l/:code/view`.

- [ ] **Step 3: Write `src/assign/user-agent.ts`**

```ts
import type { ViewDoc } from "./store.ts";

const BOTS =
  /bot\b|bot\/|crawler|spider|preview|whatsapp|telegrambot|slackbot|facebookexternalhit|facebookcatalog|discordbot|twitterbot|linkedinbot|googlebot|bingbot|embedly|skypeuripreview|headlesschrome|python-requests|curl\/|wget\//i;

/** A bot, a link-preview fetcher, or no user agent at all. */
export function isBot(userAgent: string): boolean {
  return userAgent.trim() === "" || BOTS.test(userAgent);
}

export function browserOf(userAgent: string): string {
  if (/Edg\//.test(userAgent)) return "Edge";
  if (/OPR\/|Opera/.test(userAgent)) return "Opera";
  if (/SamsungBrowser\//.test(userAgent)) return "Samsung Internet";
  if (/Firefox\/|FxiOS\//.test(userAgent)) return "Firefox";
  if (/Chrome\/|CriOS\//.test(userAgent)) return "Chrome";
  if (/Safari\//.test(userAgent) && /Version\//.test(userAgent)) return "Safari";
  return "Other";
}

export function deviceTypeOf(userAgent: string): ViewDoc["deviceType"] {
  if (/iPad|Tablet|PlayBook|Silk\//i.test(userAgent) || (/Android/i.test(userAgent) && !/Mobile/i.test(userAgent))) return "tablet";
  if (/Mobi|iPhone|iPod|Android/i.test(userAgent)) return "mobile";
  return "desktop";
}
```

- [ ] **Step 4: Add the beacon to `src/assign/link.ts`**

```ts
import { ownerFromAccess } from "./auth.ts";
import { recordEvent } from "./events.ts";
import { browserOf, deviceTypeOf, isBot } from "./user-agent.ts";

  // Inside linkRoutes:
  app.post("/:code/view", async (request, reply) => {
    const assignment = await withAssignment(request);
    if (!assignment) return reply.code(404).send();
    const userAgent = String(request.headers["user-agent"] ?? "").slice(0, 500);
    const counted = !isBot(userAgent) && !(await ownerFromAccess(ctx, request));
    const now = ctx.now();
    await store.views.insertOne({
      ownerId: assignment.ownerId,
      assignmentId: assignment._id,
      viewedAt: now,
      userAgent,
      browser: browserOf(userAgent),
      deviceType: deviceTypeOf(userAgent),
      counted,
      outcome: "ok",
    });
    if (!counted) return reply.code(204).send();

    // Only the request that finds firstViewedAt still empty wins, so two tabs make one "opened" event.
    const first = await store.assignments.findOneAndUpdate(
      { _id: assignment._id, firstViewedAt: null },
      { $set: { firstViewedAt: now, lastViewedAt: now }, $inc: { viewCount: 1 } },
    );
    if (first) {
      const list = await store.lists.findOne({ _id: assignment.listId });
      const person = await store.people.findOne({ _id: assignment.personId });
      await recordEvent(ctx, {
        ownerId: assignment.ownerId,
        kind: "opened",
        actor: "assignee",
        summary: `${person?.name ?? "Someone"} opened “${list?.name ?? "a List"}”`,
        listId: assignment.listId,
        personId: assignment.personId,
        assignmentId: assignment._id,
      });
    } else {
      await store.assignments.updateOne({ _id: assignment._id }, { $set: { lastViewedAt: now }, $inc: { viewCount: 1 } });
    }
    return reply.code(204).send();
  });
```

Fastify parses `text/plain` bodies (what `navigator.sendBeacon` sends) by default and needs no parser. An empty POST body is fine.

The rate-limit hook in `linkRoutes` also covers the beacon. That's intended: 60 per minute per IP across all link requests.

- [ ] **Step 5: Send the beacon from the link page**

In `src/assign/views/link.ejs`, just before `<%- include("footer") %>`:

```html
<script>
  // Counts this open; the server ignores bots and the Owner's own visits.
  if (!sessionStorage.getItem("viewed:<%= code %>:" + performance.timeOrigin)) {
    sessionStorage.setItem("viewed:<%= code %>:" + performance.timeOrigin, "1");
    navigator.sendBeacon(location.pathname.replace(/\/$/, "") + "/view");
  }
</script>
```

(`performance.timeOrigin` is per page load, so this sends one beacon per load. Task 8's refetch of `<main>` doesn't rerun it, because the script sits inside `<main>` and swapped-in scripts don't execute.)

- [ ] **Step 6: Run the tests and see them pass**

Run: `npx tsc --noEmit && npx vitest run test/assign`
Expected: PASS.

- [ ] **Step 7: Commit** (tick ticket 06)

```bash
git add src/assign test/assign .scratch/task-assignment/issues/06-viewed-tracking.md
git commit -m "Task assignment: viewed tracking (ticket 06)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: The Board and activity feed (ticket 07)

**Files:**
- Create: `src/assign/board.ts`, `src/assign/views/feed.ejs`
- Modify: `src/assign/tasks.ts` (`afterStatusChange`), `src/assign/index.ts` (the `/` route moves to `board.ts`), `src/assign/views/board.ejs`
- Test: `test/assign/board.test.ts`

**Interfaces:**
- Consumes: the store, `recordEvent`, `render`, `parseId`
- Produces:
  - `boardRoutes(app, ctx)`, providing `GET /assign` and `GET /assign/feed`
  - `unreadCount(ctx, owner): Promise<number>`
  - `FEED_LIMIT = 200`

- [ ] **Step 1: Write the failing tests**

`test/assign/board.test.ts`:

```ts
import { ObjectId } from "mongodb";
import { describe, expect, it } from "vitest";
import { useAssignApp } from "./harness.ts";

describe("Task assignment: the Board", () => {
  const t = useAssignApp();

  /** Sara's workspace: Omar has "Move-out" (2 Tasks), Lina has "Garden" (1), plus a draft and a loose Task. */
  async function workspace() {
    const owner = await t.logIn("sara@example.com");
    const make = async (title: string, tags = "") => {
      await owner.post("/assign/tasks", { title, tags });
      return (await t.store().tasks.findOne({ title }))!._id.toHexString();
    };
    const list = async (name: string, ids: string[], person?: string) => {
      await owner.post("/assign/lists", { name, taskIds: ids });
      const id = (await t.store().lists.findOne({ name }))!._id.toHexString();
      if (person) await owner.post(`/assign/lists/${id}/assign`, { person });
      return id;
    };
    const books = await make("Pack books", "boxes");
    const oven = await make("Clean oven", "kitchen");
    const hedge = await make("Trim hedge", "garden");
    const draftTask = await make("Paint fence");
    await make("Loose task");
    const moveOut = await list("Move-out", [books, oven], "Omar");
    await list("Garden", [hedge], "Lina");
    await list("Later", [draftTask]);
    const code = async (listId: string) => (await t.store().assignments.findOne({ active: true, listId: new ObjectId(listId) }))!.code;
    return { owner, books, oven, hedge, moveOut, omarCode: await code(moveOut) };
  }

  const section = (html: string, heading: string) => {
    const start = html.indexOf(`<h2>${heading}`);
    const end = html.indexOf("<h2>", start + 1);
    return html.slice(start, end === -1 ? undefined : end);
  };

  it("shows one section per Person with progress, viewed state and blocked reasons", async () => {
    const { owner, books, oven, omarCode } = await workspace();
    const assignee = t.agent("198.51.100.20");
    await assignee.post(`/l/${omarCode}/tasks/${books}/status`, { status: "done" });
    await assignee.post(`/l/${omarCode}/tasks/${oven}/status`, { status: "blocked", reason: "No cleaner" });
    await t.app().inject({ method: "POST", url: `/l/${omarCode}/view`, headers: { "user-agent": "Mozilla/5.0 (iPhone) Version/18.0 Safari/604.1" } });

    const board = (await owner.get("/assign")).body;
    const omar = section(board, "Omar");
    expect(omar).toContain("Move-out");
    expect(omar).toContain("1 of 2 done");
    expect(omar).toMatch(/Viewed <time datetime="2026-11-12T09:00:00.000Z">/);
    expect(omar).toContain("Clean oven");
    expect(omar).toContain("No cleaner");
    expect(section(board, "Lina")).toContain("Not opened");
  });

  it("shows unassigned Tasks and draft Lists in their own section", async () => {
    const { owner } = await workspace();
    const unassigned = section((await owner.get("/assign")).body, "Not assigned");
    expect(unassigned).toContain("Loose task");
    expect(unassigned).toContain("Later");
    expect(unassigned).not.toContain("Move-out");
  });

  it("filters by Person, tag and status", async () => {
    const { owner, oven, omarCode } = await workspace();
    await t.agent().post(`/l/${omarCode}/tasks/${oven}/status`, { status: "blocked", reason: "No cleaner" });
    const lina = (await t.store().people.findOne({ name: "Lina" }))!._id.toHexString();

    const byPerson = (await owner.get(`/assign?person=${lina}`)).body;
    expect(byPerson).toContain("Garden");
    expect(byPerson).not.toContain("Move-out");

    const byTag = (await owner.get("/assign?tag=kitchen")).body;
    expect(byTag).toContain("Clean oven");
    expect(byTag).not.toContain("Pack books");
    expect(byTag).not.toContain("Trim hedge");

    const byStatus = (await owner.get("/assign?status=blocked")).body;
    expect(byStatus).toContain("Clean oven");
    expect(byStatus).not.toContain("Pack books");
    expect(byStatus).not.toContain("Garden");
  });

  it("adds one list-complete event per completion", async () => {
    const { books, oven, omarCode } = await workspace();
    const assignee = t.agent();
    await assignee.post(`/l/${omarCode}/tasks/${books}/status`, { status: "done" });
    await assignee.post(`/l/${omarCode}/tasks/${oven}/status`, { status: "done" });
    await assignee.post(`/l/${omarCode}/tasks/${oven}/status`, { status: "done" });
    expect(await t.store().events.countDocuments({ kind: "list-complete" })).toBe(1);

    await assignee.post(`/l/${omarCode}/tasks/${oven}/status`, { status: "open" });
    await assignee.post(`/l/${omarCode}/tasks/${oven}/status`, { status: "done" });
    const complete = await t.store().events.find({ kind: "list-complete" }).toArray();
    expect(complete.map((event) => event.summary)).toEqual(["“Move-out” is complete", "“Move-out” is complete"]);
  });

  it("counts unread events in a badge, cleared by opening the feed, which shows at most 200", async () => {
    const { owner } = await workspace();
    const before = (await owner.get("/assign")).body;
    const unread = await t.store().events.countDocuments();
    expect(before).toContain(`aria-label="${unread} unread"`);

    const feed = await owner.get("/assign/feed");
    expect(feed.body).toContain("You assigned “Move-out” to Omar");
    expect((await owner.get("/assign")).body).not.toContain("unread");

    for (let i = 0; i < 210; i++) await owner.post("/assign/tasks", { title: `Bulk ${i}` });
    const long = (await owner.get("/assign/feed")).body;
    expect(long.match(/class="event card"/g)).toHaveLength(200);
    expect(long).toContain("You created “Bulk 209”");
  });

  it("keeps the feed and badge per Owner", async () => {
    await workspace();
    const omar = await t.logIn("omar@example.com", t.agent("192.0.2.3"));
    const feed = (await omar.get("/assign/feed")).body;
    expect(feed).not.toContain("Move-out");
  });
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run test/assign/board.test.ts`
Expected: FAIL. The Board is still the Task 1 placeholder.

- [ ] **Step 3: Emit one "list complete" event in `src/assign/tasks.ts`**

Replace the empty `afterStatusChange` with:

```ts
/** When the last open Task of a List is done, one "list complete" event. */
async function afterStatusChange(ctx: AssignContext, task: WithId<TaskDoc>, status: TaskStatus) {
  if (status !== "done" || task.status === "done" || !task.listId) return;
  const left = await ctx.store.tasks.countDocuments({ listId: task.listId, status: { $ne: "done" } });
  if (left > 0) return;
  const list = await ctx.store.lists.findOne({ _id: task.listId });
  const assignment = await ctx.store.assignments.findOne({ listId: task.listId, active: true });
  await recordEvent(ctx, {
    ownerId: task.ownerId,
    kind: "list-complete",
    actor: "assignee",
    summary: `“${list?.name ?? "A List"}” is complete`,
    listId: task.listId,
    personId: assignment?.personId ?? null,
    assignmentId: assignment?._id ?? null,
  });
}
```

`task.status === "done"` here is the status before the change, so marking an already done Task done again adds nothing. The test relies on that.

- [ ] **Step 4: Write `src/assign/board.ts`**

```ts
import type { FastifyInstance } from "fastify";
import type { ObjectId, WithId } from "mongodb";
import type { AssignContext } from "./context.ts";
import { parseId, render } from "./http.ts";
import type { OwnerDoc, TaskDoc, TaskStatus } from "./store.ts";

export const FEED_LIMIT = 200;

export function unreadCount(ctx: AssignContext, owner: WithId<OwnerDoc>): Promise<number> {
  return ctx.store.events.countDocuments({ ownerId: owner._id, seq: { $gt: owner.lastSeenEventSeq } }, { limit: 999 });
}

type Filter = { person: ObjectId | null; tag: string; status: TaskStatus | "" };

/** The Board and the activity feed, under `/assign`, behind login. */
export function boardRoutes(app: FastifyInstance, ctx: AssignContext) {
  const { store } = ctx;

  app.get("/", async (request, reply) => {
    const owner = request.owner!;
    const ownerId = owner._id;
    const query = request.query as { person?: string; tag?: string; status?: string };
    const filter: Filter = {
      person: parseId(query.person),
      tag: String(query.tag ?? "").toLowerCase(),
      status: (["open", "blocked", "done"] as const).find((one) => one === query.status) ?? "",
    };
    const keep = (task: WithId<TaskDoc>) =>
      (!filter.tag || task.tags.includes(filter.tag)) && (!filter.status || task.status === filter.status);

    const [tasks, lists, people, assignments] = await Promise.all([
      store.tasks.find({ ownerId }).sort({ createdAt: 1 }).toArray(),
      store.lists.find({ ownerId }).sort({ createdAt: 1 }).toArray(),
      store.people.find({ ownerId }).sort({ nameLower: 1 }).toArray(),
      store.assignments.find({ ownerId, active: true }).toArray(),
    ]);
    const tasksOf = (listId: ObjectId) => tasks.filter((task) => task.listId?.equals(listId));
    const filtering = Boolean(filter.tag || filter.status);

    const sections = people
      .filter((person) => !filter.person || person._id.equals(filter.person))
      .map((person) => ({
        person,
        lists: assignments
          .filter((assignment) => assignment.personId.equals(person._id))
          .map((assignment) => {
            const list = lists.find((one) => one._id.equals(assignment.listId))!;
            const all = tasksOf(list._id);
            return {
              list,
              assignment,
              done: all.filter((task) => task.status === "done").length,
              total: all.length,
              blocked: all.filter((task) => task.status === "blocked"),
              shown: all.filter(keep),
            };
          })
          .filter((entry) => !filtering || entry.shown.length > 0),
      }))
      .filter((section) => section.lists.length > 0);

    const unassignedTasks = filter.person ? [] : tasks.filter((task) => !task.listId && keep(task));
    const drafts = filter.person
      ? []
      : lists
          .filter((list) => list.status === "draft")
          .map((list) => ({ list, shown: tasksOf(list._id).filter(keep), total: tasksOf(list._id).length }))
          .filter((entry) => !filtering || entry.shown.length > 0);

    const allTags = [...new Set(tasks.flatMap((task) => task.tags))].sort();
    return render(reply, "board", {
      title: "Board",
      sections,
      unassignedTasks,
      drafts,
      people,
      allTags,
      filter: { person: filter.person?.toHexString() ?? "", tag: filter.tag, status: filter.status },
      unread: await unreadCount(ctx, owner),
      stream: "/assign/events",
    });
  });

  app.get("/feed", async (request, reply) => {
    const owner = request.owner!;
    const events = await store.events.find({ ownerId: owner._id }).sort({ seq: -1 }).limit(FEED_LIMIT).toArray();
    const newest = events[0]?.seq ?? owner.lastSeenEventSeq;
    await store.owners.updateOne({ _id: owner._id, lastSeenEventSeq: { $lt: newest } }, { $set: { lastSeenEventSeq: newest } });
    return render(reply, "feed", { title: "Activity", events, unread: 0, stream: "/assign/events" });
  });
}
```

In `index.ts`, delete the Task 1 placeholder `owner.get("/", ...)` and register `boardRoutes(owner, ctx);`.

- [ ] **Step 5: Write the views**

`src/assign/views/board.ejs`:

```html
<%- include("header") %>
<h1>Board</h1>
<form method="get" action="/assign" class="card">
  <label for="f-person">Person</label>
  <select id="f-person" name="person"><option value="">Everyone</option>
    <% for (const one of people) { %><option value="<%= one._id %>"<% if (filter.person === one._id.toHexString()) { %> selected<% } %>><%= one.name %></option><% } %></select>
  <label for="f-tag">Tag</label>
  <select id="f-tag" name="tag"><option value="">Any</option>
    <% for (const one of allTags) { %><option<% if (filter.tag === one) { %> selected<% } %>><%= one %></option><% } %></select>
  <label for="f-status">Status</label>
  <select id="f-status" name="status"><option value="">Any</option>
    <% for (const one of ["open", "blocked", "done"]) { %><option<% if (filter.status === one) { %> selected<% } %>><%= one %></option><% } %></select>
  <button>Filter</button>
</form>
<% for (const section of sections) { %>
<h2><%= section.person.name %></h2>
<% for (const entry of section.lists) { %>
<div class="card">
  <a href="/assign/lists/<%= entry.list._id %>"><strong><%= entry.list.name %></strong></a>
  <span class="muted"><%= entry.done %> of <%= entry.total %> done ·
    <% if (entry.assignment.lastViewedAt) { %>Viewed <time datetime="<%= entry.assignment.lastViewedAt.toISOString() %>"><%= entry.assignment.lastViewedAt.toISOString() %></time><% } else { %>Not opened<% } %></span>
  <% for (const task of entry.blocked) { %><p class="blocked">⚠ <%= task.title %>: <%= task.blockedReason %></p><% } %>
  <ul><% for (const task of entry.shown) { %><li><a href="/assign/tasks/<%= task._id %>"><%= task.title %></a> <span class="<%= task.status %>"><%= task.status %></span></li><% } %></ul>
</div>
<% } %>
<% } %>
<% if (unassignedTasks.length || drafts.length) { %>
<h2>Not assigned</h2>
<% for (const entry of drafts) { %>
<div class="card"><a href="/assign/lists/<%= entry.list._id %>"><%= entry.list.name %></a> <span class="muted">Draft · <%= entry.total %> Tasks</span></div>
<% } %>
<% for (const task of unassignedTasks) { %>
<div class="card"><a href="/assign/tasks/<%= task._id %>"><%= task.title %></a> <span class="<%= task.status %>"><%= task.status %></span></div>
<% } %>
<% } %>
<% if (!sections.length && !unassignedTasks.length && !drafts.length) { %><p class="muted">Nothing here yet. Start by adding <a href="/assign/tasks">Tasks</a>.</p><% } %>
<%- include("footer") %>
```

`src/assign/views/feed.ejs`:

```html
<%- include("header") %>
<h1>Activity</h1>
<% for (const event of events) { %>
<div class="event card"><%= event.summary %> <span class="muted"><time datetime="<%= event.createdAt.toISOString() %>"><%= event.createdAt.toISOString() %></time></span></div>
<% } %>
<% if (events.length === 0) { %><p class="muted">Nothing has happened yet.</p><% } %>
<%- include("footer") %>
```

- [ ] **Step 6: Run the tests and see them pass**

Run: `npx tsc --noEmit && npx vitest run test/assign`
Expected: PASS. The Task 6 test "starts a reassigned List as Not opened" still passes, because `list.ejs` already shows "Not opened".

- [ ] **Step 7: Commit** (tick ticket 07)

```bash
git add src/assign test/assign .scratch/task-assignment/issues/07-board-and-feed.md
git commit -m "Task assignment: the Board and activity feed (ticket 07)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Live updates (ticket 08)

**Files:**
- Create: `src/assign/sse.ts`
- Modify: `src/assign/board.ts` (`/events` route), `src/assign/link.ts` (`/:code/events` route), `src/assign/views/live.ejs`
- Test: `test/assign/sse-client.ts`, `test/assign/live.test.ts`

**Interfaces:**
- Consumes: `Hub`, `EventDoc`, `latestSeq`, `activeAssignment`, `requireOwner` (the board scope already has it)
- Produces:
  - `streamEvents(ctx, request, reply, scope: { ownerId: ObjectId; listId?: ObjectId; assignmentId?: ObjectId })`
  - `REPLAY_LIMIT = 500`
  - Wire format: `id: <seq>`, then `data: {"kind","summary","alert","taskId","listId"}`. Special events are `event: reset` and `event: revoked`.

- [ ] **Step 1: Write the SSE test client**

`test/assign/sse-client.ts`:

```ts
export type SseEvent = { id: string | null; event: string; data: any };

/** Opens an SSE stream with fetch and reads it event by event. Resolves once the server says it's connected. */
export async function openStream(url: string, headers: Record<string, string> = {}) {
  const controller = new AbortController();
  const response = await fetch(url, { headers: { accept: "text/event-stream", ...headers }, signal: controller.signal });
  if (!response.body) throw new Error("no body");
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";

  async function next(timeoutMs = 2000): Promise<SseEvent> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const end = buffer.indexOf("\n\n");
      if (end >= 0) {
        const block = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        if (block.split("\n").every((line) => line.startsWith(":"))) continue;
        const event: SseEvent = { id: null, event: "message", data: null };
        let data = "";
        for (const line of block.split("\n")) {
          const at = line.indexOf(": ");
          const [key, value] = at < 0 ? [line, ""] : [line.slice(0, at), line.slice(at + 2)];
          if (key === "id") event.id = value;
          else if (key === "event") event.event = value;
          else if (key === "data") data += value;
        }
        event.data = data ? JSON.parse(data) : null;
        return event;
      }
      const left = deadline - Date.now();
      if (left <= 0) throw new Error("timed out waiting for an event");
      const chunk = await Promise.race([
        reader.read(),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timed out waiting for an event")), left)),
      ]);
      if (chunk.done) throw new Error("stream ended");
      buffer += chunk.value;
    }
  }

  /** True when nothing arrives within `ms`. */
  async function quiet(ms = 300): Promise<boolean> {
    try {
      await next(ms);
      return false;
    } catch (error) {
      return (error as Error).message.startsWith("timed out");
    }
  }

  // The server writes ": connected" once subscribed and caught up.
  while (!buffer.includes(": connected\n\n")) {
    const chunk = await reader.read();
    if (chunk.done) throw new Error(`stream closed with ${response.status}`);
    buffer += chunk.value;
  }
  buffer = buffer.replace(": connected\n\n", "");
  return { status: response.status, headers: response.headers, next, quiet, close: () => controller.abort() };
}
```

- [ ] **Step 2: Write the failing tests**

`test/assign/live.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useAssignApp, type Agent } from "./harness.ts";
import { openStream } from "./sse-client.ts";

describe("Task assignment: live updates", () => {
  const t = useAssignApp();
  let base = "";
  const streams: Array<{ close(): void }> = [];

  beforeEach(async () => {
    base = await t.app().listen({ port: 0, host: "127.0.0.1" });
  });
  afterEach(() => {
    for (const stream of streams.splice(0)) stream.close();
  });

  async function assigned(email = "sara@example.com", ip = "203.0.113.1") {
    const owner = await t.logIn(email, t.agent(ip));
    await owner.post("/assign/tasks", { title: `Pack books ${email}` });
    const taskId = (await t.store().tasks.findOne({ title: `Pack books ${email}` }))!._id.toHexString();
    await owner.post("/assign/lists", { name: `Move-out ${email}`, taskIds: [taskId] });
    const listId = (await t.store().lists.findOne({ name: `Move-out ${email}` }))!._id.toHexString();
    await owner.post(`/assign/lists/${listId}/assign`, { person: "Omar" });
    const code = (await t.store().assignments.findOne({ listId: (await t.store().lists.findOne({ name: `Move-out ${email}` }))!._id, active: true }))!.code;
    return { owner, taskId, listId, code };
  }

  const ownerStream = async (owner: Agent, headers: Record<string, string> = {}) => {
    const stream = await openStream(`${base}/assign/events`, { cookie: owner.cookieHeader(), ...headers });
    streams.push(stream);
    return stream;
  };
  const linkStream = async (code: string, headers: Record<string, string> = {}) => {
    const stream = await openStream(`${base}/l/${code}/events`, headers);
    streams.push(stream);
    return stream;
  };

  it("sends an Assignee's change to the open Board as an alert, with the event's seq as its ID", async () => {
    const { owner, taskId, code } = await assigned();
    const board = await ownerStream(owner);
    await t.agent().post(`/l/${code}/tasks/${taskId}/status`, { status: "done" });

    const event = await board.next();
    const saved = (await t.store().events.find().sort({ seq: -1 }).limit(2).toArray()).reverse();
    expect(event.id).toBe(String(saved[0]!.seq));
    expect(event.data).toMatchObject({ kind: "task-status", alert: true, summary: "Omar marked “Pack books sara@example.com” done" });
    expect((await board.next()).data).toMatchObject({ kind: "list-complete" });
  });

  it("sends an Owner's change to the open link page", async () => {
    const { owner, taskId, code } = await assigned();
    const page = await linkStream(code);
    await owner.post(`/assign/tasks/${taskId}/status`, { status: "blocked", reason: "Wait" });
    expect((await page.next()).data).toMatchObject({ kind: "task-status", alert: false });
  });

  it("never sends one Owner's events to another, or another List's to a link page", async () => {
    const sara = await assigned("sara@example.com", "203.0.113.1");
    const omar = await assigned("omar@example.com", "203.0.113.2");
    const omarBoard = await ownerStream(omar.owner);
    const omarPage = await linkStream(omar.code);
    await sara.owner.post(`/assign/tasks/${sara.taskId}/status`, { status: "done" });
    expect(await omarBoard.quiet()).toBe(true);
    expect(await omarPage.quiet()).toBe(true);
  });

  it("replays events after Last-Event-ID, and resets for an unknown or too-old ID", async () => {
    const { owner, taskId } = await assigned();
    const lastSeen = (await t.store().counters.findOne({ _id: "events" }))!.seq;
    await owner.post(`/assign/tasks/${taskId}/status`, { status: "blocked", reason: "Wait" });
    await owner.post(`/assign/tasks/${taskId}/status`, { status: "open" });

    const resumed = await ownerStream(owner, { "last-event-id": String(lastSeen) });
    expect([(await resumed.next()).id, (await resumed.next()).id]).toEqual([String(lastSeen + 1), String(lastSeen + 2)]);
    expect(await resumed.quiet()).toBe(true);

    const unknown = await ownerStream(owner, { "last-event-id": "999999" });
    expect((await unknown.next()).event).toBe("reset");

    for (let i = 0; i < 501; i++) await owner.post("/assign/tasks", { title: `Bulk ${i}` });
    const behind = await ownerStream(owner, { "last-event-id": String(lastSeen) });
    expect((await behind.next()).event).toBe("reset");
  });

  it("delivers each event once when a change lands during the replay", async () => {
    const { owner, taskId } = await assigned();
    const lastSeen = (await t.store().counters.findOne({ _id: "events" }))!.seq;
    const [stream] = await Promise.all([
      ownerStream(owner, { "last-event-id": String(lastSeen) }),
      owner.post(`/assign/tasks/${taskId}/status`, { status: "done" }),
    ]);
    const ids = [(await stream.next()).id];
    while (!(await stream.quiet())) ids.push("extra");
    expect(ids).toEqual([String(lastSeen + 1)]);
  });

  it("tells an open link page its link was revoked, and closes the stream", async () => {
    const { owner, listId, code } = await assigned();
    const page = await linkStream(code);
    await owner.post(`/assign/lists/${listId}/revoke`);
    const events = [await page.next(), await page.next()];
    expect(events.map((event) => event.event)).toEqual(["message", "revoked"]);
    await expect(page.next(500)).rejects.toThrow(/stream ended|timed out/);
  });

  it("refuses a stream for a dead link or without a session", async () => {
    const response = await fetch(`${base}/l/AAAAAAAAAA/events`);
    expect(response.status).toBe(404);
    const anonymous = await fetch(`${base}/assign/events`, { redirect: "manual" });
    expect(anonymous.status).toBe(302);
  });
});
```

"Delivers each event once" checks that the hub subscription and the replay don't both deliver the same event. The test helper's `quiet()` returns false if any further event arrives.

The harness's `afterEach` calls `app.close()`. That also closes a listening server, so no extra cleanup is needed.

- [ ] **Step 3: Run them and see them fail**

Run: `npx vitest run test/assign/live.test.ts`
Expected: FAIL. `/assign/events` returns 404, so `openStream` throws "stream closed with 404".

- [ ] **Step 4: Write `src/assign/sse.ts`**

```ts
import type { FastifyReply, FastifyRequest } from "fastify";
import type { ObjectId } from "mongodb";
import type { AssignContext } from "./context.ts";
import { latestSeq } from "./events.ts";
import type { EventDoc } from "./store.ts";

export const REPLAY_LIMIT = 500;
const KEEP_ALIVE_MS = 25_000;

/** An Assignee's change the Owner should be alerted to: done, blocked, or a first open. */
function isAlert(event: EventDoc): boolean {
  return event.actor === "assignee" && (event.kind === "opened" || (event.kind === "task-status" && (event.to === "done" || event.to === "blocked")));
}

/**
 * Streams the scope's events as SSE: replays those after Last-Event-ID (or sends `reset`), then live ones.
 * Subscribes before replaying, so nothing saved meanwhile is missed, and skips any event already sent.
 */
export async function streamEvents(
  ctx: AssignContext,
  request: FastifyRequest,
  reply: FastifyReply,
  scope: { ownerId: ObjectId; listId?: ObjectId; assignmentId?: ObjectId },
) {
  const matches = (event: EventDoc) =>
    event.ownerId.equals(scope.ownerId) && (!scope.listId || (event.listId?.equals(scope.listId) ?? false));

  reply.hijack();
  const raw = reply.raw;
  raw.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    "x-accel-buffering": "no",
    ...(scope.assignmentId ? { "x-robots-tag": "noindex, nofollow", "referrer-policy": "no-referrer" } : {}),
  });

  const sent = new Set<number>();
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    clearInterval(keepAlive);
    unsubscribe();
    raw.end();
  };
  const deliver = (event: EventDoc) => {
    if (closed || sent.has(event.seq)) return;
    sent.add(event.seq);
    if (sent.size > 2_000) sent.delete(sent.values().next().value!);
    const data = {
      kind: event.kind,
      summary: event.summary,
      alert: isAlert(event),
      taskId: event.taskId?.toHexString() ?? null,
      listId: event.listId?.toHexString() ?? null,
    };
    raw.write(`id: ${event.seq}\ndata: ${JSON.stringify(data)}\n\n`);
    if (scope.assignmentId && event.kind === "revoked" && event.assignmentId?.equals(scope.assignmentId)) {
      raw.write("event: revoked\ndata: {}\n\n");
      close();
    }
  };

  let replaying = true;
  const pending: EventDoc[] = [];
  const unsubscribe = ctx.hub.subscribe((event) => {
    if (!matches(event)) return;
    if (replaying) pending.push(event);
    else deliver(event);
  });
  const keepAlive = setInterval(() => raw.write(": keep-alive\n\n"), KEEP_ALIVE_MS);
  request.raw.on("close", close);

  const header = request.headers["last-event-id"];
  if (typeof header === "string" && header !== "") {
    const after = Number(header);
    const newest = await latestSeq(ctx.store);
    if (!Number.isInteger(after) || after < 0 || after > newest) {
      raw.write("event: reset\ndata: {}\n\n");
    } else {
      const missed = await ctx.store.events
        .find({ ownerId: scope.ownerId, ...(scope.listId ? { listId: scope.listId } : {}), seq: { $gt: after } })
        .sort({ seq: 1 })
        .limit(REPLAY_LIMIT + 1)
        .toArray();
      if (missed.length > REPLAY_LIMIT) raw.write("event: reset\ndata: {}\n\n");
      else for (const event of missed) deliver(event);
    }
  }
  replaying = false;
  for (const event of pending.sort((a, b) => a.seq - b.seq)) deliver(event);
  if (!closed) raw.write(": connected\n\n");
}
```

`clearInterval(keepAlive)` inside `close` refers to `keepAlive` before its `const` line has run only if `close` runs that early. It can't: `close` is wired to `request.raw` after `keepAlive` is assigned, and `deliver` only runs after it too. Leave the order as written.

- [ ] **Step 5: Add the two stream routes**

In `src/assign/board.ts`, inside `boardRoutes`:

```ts
  app.get("/events", (request, reply) => streamEvents(ctx, request, reply, { ownerId: request.owner!._id }));
```

In `src/assign/link.ts`, inside `linkRoutes`:

```ts
  app.get("/:code/events", async (request, reply) => {
    const assignment = await withAssignment(request);
    if (!assignment) return reply.code(404).type("text/plain").send("No longer available.");
    return streamEvents(ctx, request, reply, { ownerId: assignment.ownerId, listId: assignment.listId, assignmentId: assignment._id });
  });
```

(Import `streamEvents` from `./sse.ts` in both files.)

- [ ] **Step 6: Apply events in the browser: `src/assign/views/live.ejs`**

Append to the existing script:

```html
<script>
  (() => {
    const url = document.body.dataset.stream;
    if (!url || !window.EventSource) return;
    const source = new EventSource(url);
    let timer;
    // Re-render <main> from the server, so pages need no client-side templates.
    const refresh = () => {
      clearTimeout(timer);
      timer = setTimeout(async () => {
        const response = await fetch(location.href, { credentials: "same-origin" });
        if (!response.ok) return location.reload();
        const next = new DOMParser().parseFromString(await response.text(), "text/html").querySelector("main");
        const active = document.activeElement;
        // Leave the page alone while someone is typing in it.
        if (next && !(active && active.closest("main") && /INPUT|TEXTAREA|SELECT/.test(active.tagName))) {
          document.querySelector("main").replaceWith(next);
          localTimes();
        }
      }, 150);
    };
    const alerts = document.getElementById("alerts");
    source.onmessage = (message) => {
      const data = JSON.parse(message.data);
      if (data.alert && document.querySelector("nav")) {
        const alert = document.createElement("div");
        alert.textContent = data.summary;
        alerts.append(alert);
        setTimeout(() => alert.remove(), 8000);
      }
      refresh();
    };
    source.addEventListener("reset", refresh);
    source.addEventListener("revoked", () => {
      source.close();
      location.reload();
    });
  })();
</script>
```

(Alerts show only on Owner pages, which have the `<nav>`. Assignee pages just refresh.)

- [ ] **Step 7: Run the tests and see them pass**

Run: `npx tsc --noEmit && npx vitest run test/assign`
Expected: PASS.

- [ ] **Step 8: Try it by hand**

Start the app with the module on:

```bash
ASSIGN_JWT_SECRET=$(openssl rand -base64 48) PUBLIC_URL=http://127.0.0.1:3000 npm start
```

Then:
1. Open `http://127.0.0.1:3000/assign/login` and enter an email. Copy the login link from the console and open it.
2. Add two Tasks, make a List, and assign it to "Omar".
3. Open the link in a private window (or on a phone on the same network, with `HOST=0.0.0.0`).
4. Tick a Task on the link page. The Board in the first window should update within 2 seconds and show an alert.

Expected: as described. Note the result in ticket 08's last box.

- [ ] **Step 9: Commit** (tick ticket 08)

```bash
git add src/assign test/assign .scratch/task-assignment/issues/08-live-updates.md
git commit -m "Task assignment: live updates over SSE (ticket 08)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Deletion rules and housekeeping (ticket 09)

**Files:**
- Create: `src/assign/people.ts`, `src/assign/housekeeping.ts`, `src/assign/views/people.ejs`, `src/assign/views/confirm-delete.ejs`
- Modify: `src/assign/tasks.ts` (confirm page), `src/assign/lists.ts` (delete), `src/assign/index.ts` (people routes and the housekeeping timer)
- Test: `test/assign/deletion.test.ts`

**Interfaces:**
- Consumes: `revokeAssignment`, `recordEvent`, `findOwnTask`, `findOwnList`, `render`
- Produces:
  - `peopleRoutes(app, ctx)`
  - `purgeOld(store, now, retentionDays): Promise<{ views: number; loginTokens: number; refreshTokens: number }>`
  - `startHousekeeping(ctx): () => void`

- [ ] **Step 1: Write the failing tests**

`test/assign/deletion.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { purgeOld } from "../../src/assign/housekeeping.ts";
import { START, useAssignApp } from "./harness.ts";
import { openStream } from "./sse-client.ts";

const DAY = 86_400_000;

describe("Task assignment: deleting", () => {
  const t = useAssignApp();
  let base = "";
  const streams: Array<{ close(): void }> = [];
  beforeEach(async () => {
    base = await t.app().listen({ port: 0, host: "127.0.0.1" });
  });
  afterEach(() => {
    for (const stream of streams.splice(0)) stream.close();
  });

  /** Omar has "Move-out" (2 Tasks) and "Garden" (1 Task). */
  async function workspace() {
    const owner = await t.logIn("sara@example.com");
    const make = async (title: string) => {
      await owner.post("/assign/tasks", { title });
      return (await t.store().tasks.findOne({ title }))!._id.toHexString();
    };
    const list = async (name: string, ids: string[]) => {
      await owner.post("/assign/lists", { name, taskIds: ids });
      const id = (await t.store().lists.findOne({ name }))!._id;
      await owner.post(`/assign/lists/${id}/assign`, { person: "Omar" });
      return { id: id.toHexString(), code: (await t.store().assignments.findOne({ listId: id, active: true }))!.code };
    };
    const books = await make("Pack books");
    const oven = await make("Clean oven");
    const hedge = await make("Trim hedge");
    return { owner, books, oven, moveOut: await list("Move-out", [books, oven]), garden: await list("Garden", [hedge]) };
  }

  it("says what deleting a List will do, then revokes its link and returns its Tasks with their statuses", async () => {
    const { owner, books, moveOut } = await workspace();
    await owner.post(`/assign/tasks/${books}/status`, { status: "done" });
    const page = await openStream(`${base}/l/${moveOut.code}/events`);
    streams.push(page);

    const confirm = await owner.get(`/assign/lists/${moveOut.id}/delete`);
    expect(confirm.body).toContain("Revokes 1 active link and returns 2 Tasks to the pool.");
    await owner.post(`/assign/lists/${moveOut.id}/delete`);

    expect(await t.store().lists.countDocuments({ name: "Move-out" })).toBe(0);
    expect(await t.store().tasks.find({ title: { $in: ["Pack books", "Clean oven"] } }).toArray()).toEqual(
      expect.arrayContaining([expect.objectContaining({ title: "Pack books", status: "done", listId: null })]),
    );
    expect((await t.agent().get(`/l/${moveOut.code}`)).statusCode).toBe(404);
    const events = [await page.next(), await page.next()];
    expect(events.at(-1)!.event).toBe("revoked");
  });

  it("says what deleting a Person will do, revokes all their links and keeps the history", async () => {
    const { owner, moveOut, garden } = await workspace();
    await t.app().inject({ method: "POST", url: `/l/${moveOut.code}/view`, headers: { "user-agent": "Mozilla/5.0 (iPhone) Version/18.0 Safari/604.1" } });
    const omar = (await t.store().people.findOne({}))!._id.toHexString();

    const confirm = await owner.get(`/assign/people/${omar}/delete`);
    expect(confirm.body).toContain("Revokes 2 active links.");
    await owner.post(`/assign/people/${omar}/delete`);

    expect(await t.store().people.countDocuments()).toBe(0);
    for (const code of [moveOut.code, garden.code]) expect((await t.agent().get(`/l/${code}`)).statusCode).toBe(404);
    expect(await t.store().views.countDocuments()).toBe(1);
    expect(await t.store().events.countDocuments({ kind: "opened" })).toBe(1);
    expect(await t.store().lists.countDocuments({ status: "draft" })).toBe(2);
  });

  it("says when deleting a Task takes it off a link page, and does so live", async () => {
    const { owner, oven, moveOut } = await workspace();
    const page = await openStream(`${base}/l/${moveOut.code}/events`);
    streams.push(page);

    expect((await owner.get(`/assign/tasks/${oven}/delete`)).body).toContain("Removes it from Omar's link.");
    await owner.post(`/assign/tasks/${oven}/delete`);
    expect((await page.next()).data).toMatchObject({ kind: "task-deleted" });
    expect((await t.agent().get(`/l/${moveOut.code}`)).body).not.toContain("Clean oven");
  });

  it("deletes a Task that's in no List with a plain confirmation", async () => {
    const owner = await t.logIn("sara@example.com");
    await owner.post("/assign/tasks", { title: "Loose" });
    const id = (await t.store().tasks.findOne({}))!._id.toHexString();
    expect((await owner.get(`/assign/tasks/${id}/delete`)).body).toContain("Deletes it.");
  });

  it("lists People with their active link counts", async () => {
    const { owner } = await workspace();
    expect((await owner.get("/assign/people")).body).toMatch(/Omar[\s\S]*2 active links/);
  });
});

describe("Task assignment: housekeeping", () => {
  const t = useAssignApp();

  it("purges views older than the retention and expired tokens, and is safe to run twice", async () => {
    const owner = await t.logIn("sara@example.com");
    const store = t.store();
    const ownerId = (await store.owners.findOne({}))!._id;
    const view = (daysAgo: number) => ({
      ownerId,
      assignmentId: ownerId,
      viewedAt: new Date(START.getTime() - daysAgo * DAY),
      userAgent: "x",
      browser: "Other",
      deviceType: "desktop" as const,
      counted: true,
      outcome: "ok" as const,
    });
    await store.views.insertMany([view(91), view(10)]);
    // A second login link, never used: two login tokens in all, and one refresh token from the login.
    await owner.post("/assign/login", { email: "sara@example.com" });

    // 31 days on: the 91-day-old view is 122 days old (gone), the 10-day-old one 41 (kept); every token has expired.
    t.clock.advance(31 * DAY);
    expect(await purgeOld(store, t.clock.now, 90)).toEqual({ views: 1, loginTokens: 2, refreshTokens: 1 });
    expect(await store.views.countDocuments()).toBe(1);
    expect(await purgeOld(store, t.clock.now, 90)).toEqual({ views: 0, loginTokens: 0, refreshTokens: 0 });
  });
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run test/assign/deletion.test.ts`
Expected: FAIL. `housekeeping.ts` doesn't exist.

- [ ] **Step 3: Write `src/assign/housekeeping.ts`**

```ts
import type { AssignContext } from "./context.ts";
import type { AssignStore } from "./store.ts";

const DAY_MS = 86_400_000;

/** Deletes link-open logs older than the retention, and expired login and refresh tokens. Idempotent. */
export async function purgeOld(store: AssignStore, now: Date, retentionDays: number) {
  const [views, loginTokens, refreshTokens] = await Promise.all([
    store.views.deleteMany({ viewedAt: { $lt: new Date(now.getTime() - retentionDays * DAY_MS) } }),
    store.loginTokens.deleteMany({ expiresAt: { $lt: now } }),
    store.refreshTokens.deleteMany({ expiresAt: { $lt: now } }),
  ]);
  return { views: views.deletedCount, loginTokens: loginTokens.deletedCount, refreshTokens: refreshTokens.deletedCount };
}

/** Runs the purge now and then daily, in this process (no queue or cron); returns a stop function. */
export function startHousekeeping(ctx: AssignContext): () => void {
  const run = () =>
    purgeOld(ctx.store, ctx.now(), ctx.config.viewRetentionDays).catch((error) => console.error("Task assignment purge failed", error));
  void run();
  const timer = setInterval(run, DAY_MS);
  timer.unref();
  return () => clearInterval(timer);
}
```

In `index.ts`:

```ts
  const stopHousekeeping = startHousekeeping(ctx);
  app.addHook("onClose", async () => stopHousekeeping());
```

- [ ] **Step 4: Confirm pages and deletes for Tasks and Lists**

In `src/assign/tasks.ts`, add the confirm page and give the delete a correct `listId`:

```ts
  app.get("/tasks/:id/delete", async (request, reply) => {
    const task = await findOwnTask(ctx, request.owner!._id, (request.params as { id: string }).id);
    if (!task) return reply.code(404).type("text/plain").send("Not found.");
    const assignment = task.listId ? await store.assignments.findOne({ listId: task.listId, active: true }) : null;
    const person = assignment ? await store.people.findOne({ _id: assignment.personId }) : null;
    return render(reply, "confirm-delete", {
      title: `Delete “${task.title}”?`,
      effect: person ? `Removes it from ${person.name}'s link.` : "Deletes it.",
      action: `/assign/tasks/${task._id.toHexString()}/delete`,
      back: `/assign/tasks/${task._id.toHexString()}`,
    });
  });
```

In `src/assign/lists.ts`:

```ts
import { revokeAssignment } from "./assignments.ts";

  const plural = (count: number, one: string) => `${count} ${one}${count === 1 ? "" : "s"}`;

  app.get("/lists/:id/delete", async (request, reply) => {
    const list = await findOwnList(ctx, request.owner!._id, (request.params as { id: string }).id);
    if (!list) return reply.code(404).type("text/plain").send("Not found.");
    const links = await store.assignments.countDocuments({ listId: list._id, active: true });
    const tasks = await store.tasks.countDocuments({ listId: list._id });
    const effect = [links ? `Revokes ${plural(links, "active link")}` : "", `returns ${plural(tasks, "Task")} to the pool.`]
      .filter(Boolean)
      .join(" and ");
    return render(reply, "confirm-delete", {
      title: `Delete “${list.name}”?`,
      effect: effect.charAt(0).toUpperCase() + effect.slice(1),
      action: `/assign/lists/${list._id.toHexString()}/delete`,
      back: `/assign/lists/${list._id.toHexString()}`,
    });
  });

  app.post("/lists/:id/delete", async (request, reply) => {
    const list = await findOwnList(ctx, request.owner!._id, (request.params as { id: string }).id);
    if (!list) return reply.code(404).type("text/plain").send("Not found.");
    for (const assignment of await store.assignments.find({ listId: list._id, active: true }).toArray()) {
      await revokeAssignment(ctx, assignment, "deleted");
    }
    await store.tasks.updateMany({ listId: list._id }, { $set: { listId: null, updatedAt: ctx.now() } });
    await store.lists.deleteOne({ _id: list._id });
    await recordEvent(ctx, { ownerId: list.ownerId, kind: "list-deleted", summary: `You deleted the List “${list.name}”`, listId: list._id });
    return reply.redirect("/assign/lists", 303);
  });
```

`assignments.ts` imports `findOwnList` from `lists.ts`, and `lists.ts` now imports `revokeAssignment` from `assignments.ts`. That's an import cycle, but it's safe because both are only used inside functions that run after both modules have loaded.

- [ ] **Step 5: Write `src/assign/people.ts`**

```ts
import type { FastifyInstance } from "fastify";
import { revokeAssignment } from "./assignments.ts";
import type { AssignContext } from "./context.ts";
import { recordEvent } from "./events.ts";
import { parseId, render } from "./http.ts";

/** People, under `/assign`, behind login. */
export function peopleRoutes(app: FastifyInstance, ctx: AssignContext) {
  const { store } = ctx;
  const linkCount = (count: number) => `${count} active link${count === 1 ? "" : "s"}`;

  const findOwnPerson = (ownerId: import("mongodb").ObjectId, id: string) => {
    const _id = parseId(id);
    return _id ? store.people.findOne({ _id, ownerId }) : Promise.resolve(null);
  };

  app.get("/people", async (request, reply) => {
    const ownerId = request.owner!._id;
    const people = await store.people.find({ ownerId }).sort({ nameLower: 1 }).toArray();
    const active = await store.assignments.find({ ownerId, active: true }).toArray();
    const rows = people.map((person) => ({ person, links: linkCount(active.filter((one) => one.personId.equals(person._id)).length) }));
    return render(reply, "people", { title: "People", rows });
  });

  app.get("/people/:id/delete", async (request, reply) => {
    const person = await findOwnPerson(request.owner!._id, (request.params as { id: string }).id);
    if (!person) return reply.code(404).type("text/plain").send("Not found.");
    const links = await store.assignments.countDocuments({ personId: person._id, active: true });
    return render(reply, "confirm-delete", {
      title: `Delete ${person.name}?`,
      effect: links ? `Revokes ${linkCount(links)}.` : "They have no active links.",
      action: `/assign/people/${person._id.toHexString()}/delete`,
      back: "/assign/people",
    });
  });

  app.post("/people/:id/delete", async (request, reply) => {
    const person = await findOwnPerson(request.owner!._id, (request.params as { id: string }).id);
    if (!person) return reply.code(404).type("text/plain").send("Not found.");
    for (const assignment of await store.assignments.find({ personId: person._id, active: true }).toArray()) {
      await revokeAssignment(ctx, assignment, "deleted");
      await store.lists.updateOne({ _id: assignment.listId }, { $set: { status: "draft" } });
    }
    await store.people.deleteOne({ _id: person._id });
    await recordEvent(ctx, { ownerId: person.ownerId, kind: "person-deleted", summary: `You deleted ${person.name}`, personId: person._id });
    return reply.redirect("/assign/people", 303);
  });
}
```

Register `peopleRoutes(owner, ctx);` in the Owner scope.

- [ ] **Step 6: Write the views**

`src/assign/views/confirm-delete.ejs`:

```html
<%- include("header") %>
<h1><%= title %></h1>
<p><%= effect %></p>
<form method="post" action="<%= action %>" class="inline">
  <input type="hidden" name="_csrf" value="<%= csrf %>">
  <button class="primary">Delete</button>
</form>
<a href="<%= back %>">Cancel</a>
<%- include("footer") %>
```

`src/assign/views/people.ejs`:

```html
<%- include("header") %>
<h1>People</h1>
<p class="muted">People are added when you assign them a List.</p>
<% for (const row of rows) { %>
<div class="card"><strong><%= row.person.name %></strong> <span class="muted"><%= row.links %></span>
  <a href="/assign/people/<%= row.person._id %>/delete">Delete…</a></div>
<% } %>
<% if (rows.length === 0) { %><p class="muted">No People yet.</p><% } %>
<%- include("footer") %>
```

- [ ] **Step 7: Run the tests and see them pass**

Run: `npx tsc --noEmit && npx vitest run test/assign`
Expected: PASS.

- [ ] **Step 8: Run the whole suite**

Run: `npm test`
Expected: every test passes, the bot's included.

- [ ] **Step 9: Commit** (tick ticket 09; set the spec's `Status:` to `done` once ticket 08's manual box is ticked)

```bash
git add src/assign test/assign .scratch/task-assignment
git commit -m "Task assignment: deletion rules and housekeeping (ticket 09)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
