import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import Fastify from "fastify";
import { MongoClient, ObjectId, type Db } from "mongodb";
import { MongoMemoryServer } from "mongodb-memory-server";
import { assignRoutes } from "../../src/assign/index.ts";
import { loadAssignConfig } from "../../src/assign/config.ts";
import { openAssignStore } from "../../src/assign/store.ts";
import type { Mail } from "../../src/assign/mailer.ts";
import { Writable } from "node:stream";
import { purgeOld } from "../../src/assign/housekeeping.ts";
import { createRateLimiter } from "../../src/assign/rate-limit.ts";

describe("Task assignment workflow", () => {
  let mongo: MongoMemoryServer, client: MongoClient, db: Db, app: ReturnType<typeof Fastify>;
  const mail: string[] = [];
  beforeAll(async () => { mongo = await MongoMemoryServer.create(); client = await MongoClient.connect(mongo.getUri()); });
  beforeEach(async () => {
    mail.length = 0; db = client.db(`workflow_${crypto.randomUUID()}`); app = Fastify({ logger: false });
    await app.register(assignRoutes, { db, config: loadAssignConfig({ PUBLIC_URL: "http://assign.test", ASSIGN_JWT_SECRET: "x".repeat(32) })!, mailer: { send: async (m: Mail) => { mail.push(m.text); } } });
    await app.ready();
  });
  afterEach(async () => { await app.close(); });
  afterAll(async () => { await client?.close(); await mongo?.stop(); });
  function browser() {
    const cookies = new Map<string, string>();
    const remember = (reply: Awaited<ReturnType<typeof app.inject>>) => {
      for (const header of [reply.headers["set-cookie"] || []].flat()) { const pair = header.split(";")[0]!; const [key, value] = pair.split("="); if (key) cookies.set(key, value || ""); }
    };
    const cookie = () => [...cookies].map(([k, v]) => `${k}=${v}`).join("; ");
    return {
      cookie,
      async get(url: string) { const result = await app.inject({ method: "GET", url, headers: { cookie: cookie() } }); remember(result); return result; },
      async post(url: string, form: Record<string, string | string[]> = {}, headers: Record<string, string> = {}) {
        const params = new URLSearchParams(); for (const [key, value] of Object.entries(form)) for (const item of [value].flat()) params.append(key, item);
        if (url.startsWith("/assign")) params.set("csrf", cookies.get("ta_csrf") || "");
        const result = await app.inject({ method: "POST", url, headers: { cookie: cookie(), "content-type": "application/x-www-form-urlencoded", ...headers }, payload: params.toString() }); remember(result); return result;
      },
      async login(email: string) { await this.get("/assign/login"); await this.post("/assign/login", { email }); const token = new URL(mail.at(-1)!.match(/http:\/\/\S+/)![0]!).searchParams.get("token")!; await this.post("/assign/auth", { token }); await this.get("/assign/password-offer"); await this.post("/assign/password-offer"); },
    };
  }
  it("builds a List, gives one scoped link, and revokes it", async () => {
    const owner = browser(); await owner.login("owner@example.com");
    expect((await owner.post("/assign/tasks", { title: "Pack books", tags: "move" })).statusCode).toBe(303);
    const store = await openAssignStore(db); const task = (await store.tasks.findOne({ title: "Pack books" }))!;
    const listReply = await owner.post("/assign/lists", { name: "Move-out", taskIds: task._id.toHexString() });
    expect(listReply.statusCode).toBe(303);
    const list = (await store.lists.findOne({ name: "Move-out" }))!;
    expect((await owner.post(`/assign/lists/${list._id}/assign`, { person: "Omar" })).statusCode).toBe(303);
    const assignment = (await store.assignments.findOne({ listId: list._id, active: true }))!;
    const link = `/l/${assignment.code}`;
    expect((await app.inject({ method: "GET", url: link })).body).toContain("Pack books");
    expect((await app.inject({ method: "POST", url: `${link}/tasks/${task._id}/status`, headers: { "content-type": "application/x-www-form-urlencoded" }, payload: "status=done" })).statusCode).toBe(303);
    expect((await store.tasks.findOne({ _id: task._id }))!.status).toBe("done");
    expect((await owner.get("/assign")).body).toContain("1 of 1 done");
    await owner.post(`/assign/lists/${list._id}/revoke`);
    expect((await app.inject({ method: "GET", url: link })).body).toContain("no longer available");
  });
  it("offers both Task layouts while preserving tag filtering and Task links", async () => {
    const owner = browser(); await owner.login("layouts@example.com");
    await owner.post("/assign/tasks", { title: "Pack books", tags: "move" });
    await owner.post("/assign/tasks", { title: "Paint wall", tags: "repair" });
    const store = await openAssignStore(db);
    const task = (await store.tasks.findOne({ title: "Pack books" }))!;
    const html = (await owner.get("/assign/tasks?tag=move")).body;
    expect(html).toContain('aria-label="Task view"');
    expect(html).toContain('data-task-view="list"');
    expect(html).toContain('data-task-view="grid"');
    expect(html).toContain(`href="/assign/tasks/${task._id}"`);
    expect(html).toContain('name="tag" value="move"');
    expect(html).not.toContain("Paint wall");
    const empty = (await owner.get("/assign/tasks?tag=missing")).body;
    expect(empty).toContain("No Tasks tagged");
    expect(empty).not.toContain('aria-label="Task view"');
  });
  it("rejects CSRF failures and another Owner's Task ID", async () => {
    const one = browser(); await one.login("one@example.com");
    await one.post("/assign/tasks", { title: "Private" });
    const task = (await (await openAssignStore(db)).tasks.findOne({ title: "Private" }))!;
    const two = browser(); await two.login("two@example.com");
    expect((await two.get(`/assign/tasks/${task._id}`)).statusCode).toBe(404);
    expect((await two.post(`/assign/tasks/${task._id}/status`, { status: "done" })).statusCode).toBe(404);
    expect((await app.inject({ method: "POST", url: "/assign/tasks", payload: { title: "Bad" } })).statusCode).toBe(403);
  });
  it("does not log link codes", async () => {
    let output = "";
    const stream = new Writable({ write(chunk, _encoding, done) { output += String(chunk); done(); } });
    const logged = Fastify({ logger: { level: "info", stream } });
    await logged.register(assignRoutes, { db: client.db(`log_${crypto.randomUUID()}`), config: loadAssignConfig({ PUBLIC_URL: "http://assign.test", ASSIGN_JWT_SECRET: "x".repeat(32) })!, mailer: { send: async () => {} } });
    await logged.ready();
    await logged.inject({ method: "GET", url: "/l/AbCd123456" });
    await logged.close();
    expect(output).not.toContain("AbCd123456");
  });
  it("counts two simultaneous first views once and rejects a removed Task", async () => {
    const owner = browser(); await owner.login("owner@example.com");
    await owner.post("/assign/tasks", { title: "Carry boxes" });
    const store = await openAssignStore(db); const task = (await store.tasks.findOne({ title: "Carry boxes" }))!;
    await owner.post("/assign/lists", { name: "Move", taskIds: task._id.toHexString() });
    const list = (await store.lists.findOne({ name: "Move" }))!;
    await owner.post(`/assign/lists/${list._id}/assign`, { person: "Sam" });
    const assignment = (await store.assignments.findOne({ listId: list._id, active: true }))!;
    const url = `/l/${assignment.code}`;
    await Promise.all([app.inject({ method: "POST", url: `${url}/view`, headers: { "user-agent": "Mozilla/5.0 Chrome" } }), app.inject({ method: "POST", url: `${url}/view`, headers: { "user-agent": "Mozilla/5.0 Chrome" } })]);
    expect((await store.assignments.findOne({ _id: assignment._id }))!.viewCount).toBe(2);
    expect(await store.events.countDocuments({ kind: "assignment.opened" })).toBe(1);
    await owner.post(`/assign/lists/${list._id}/remove`, { taskId: task._id.toHexString() });
    const stale = await app.inject({ method: "POST", url: `${url}/tasks/${task._id}/status`, headers: { "content-type": "application/x-www-form-urlencoded" }, payload: "status=done" });
    expect(stale.statusCode).toBe(404);
  });
  it("streams a saved change to the Owner", async () => {
    const owner = browser(); await owner.login("owner@example.com");
    const address = await app.listen({ host: "127.0.0.1", port: 0 });
    const controller = new AbortController();
    try {
      const response = await fetch(`${address}/assign/events`, { headers: { cookie: owner.cookie() }, signal: controller.signal });
      expect(response.status).toBe(200);
      const reader = response.body!.getReader();
      await owner.post("/assign/tasks", { title: "Live Task" });
      let text = "";
      for (let i = 0; i < 3 && !text.includes("task.create"); i++) {
        const chunk = await Promise.race([reader.read(), new Promise<never>((_, reject) => setTimeout(() => reject(new Error("SSE timeout")), 3000))]);
        text += new TextDecoder().decode(chunk.value);
      }
      expect(text).toContain("task.create");
    } finally { controller.abort(); }
  });
  it("shows the occupied List and reuses a Person by case", async () => {
    const owner = browser(); await owner.login("owner@example.com");
    await owner.post("/assign/tasks", { title: "Paint wall" });
    const store = await openAssignStore(db); const task = (await store.tasks.findOne({ title: "Paint wall" }))!;
    await owner.post("/assign/lists", { name: "Room", taskIds: task._id.toHexString() });
    expect((await owner.get("/assign/lists")).body).toContain("already in Room");
    const list = (await store.lists.findOne({ name: "Room" }))!;
    await owner.post(`/assign/lists/${list._id}/assign`, { person: "Sara" });
    await owner.post(`/assign/lists/${list._id}/assign`, { person: "sara" });
    expect(await store.people.countDocuments({ ownerId: list.ownerId })).toBe(1);
    const active = (await store.assignments.findOne({ listId: list._id, active: true }))!;
    const old = (await store.assignments.findOne({ listId: list._id, active: false }))!;
    expect((await app.inject({ method: "GET", url: `/l/${old.code}` })).body).toContain("no longer available");
    const link = await app.inject({ method: "GET", url: `/l/${active.code}` });
    expect(link.headers["x-robots-tag"]).toBe("noindex");
    expect(link.body).toContain('<meta name="robots" content="noindex">');
    expect(link.headers["set-cookie"]).toBeUndefined();
  });
  it("records bot beacons without counting them", async () => {
    const owner = browser(); await owner.login("owner@example.com");
    await owner.post("/assign/lists", { name: "Empty" });
    const store = await openAssignStore(db), list = (await store.lists.findOne({ name: "Empty" }))!;
    await owner.post(`/assign/lists/${list._id}/assign`, { person: "Sara" });
    const assignment = (await store.assignments.findOne({ listId: list._id, active: true }))!;
    const url = `/l/${assignment.code}`;
    await app.inject({ method: "GET", url });
    await app.inject({ method: "POST", url: `${url}/view`, headers: { "user-agent": "WhatsApp" } });
    await app.inject({ method: "POST", url: `${url}/view`, headers: { "user-agent": "Mozilla/5.0 Chrome", cookie: owner.cookie() } });
    expect((await store.assignments.findOne({ _id: assignment._id }))!.viewCount).toBe(0);
    expect(await store.views.countDocuments({ assignmentId: assignment._id, counted: false })).toBe(2);
  });
  it("replays later events and resets an unknown event ID", async () => {
    const owner = browser(); await owner.login("owner@example.com");
    await owner.post("/assign/tasks", { title: "First" });
    const store = await openAssignStore(db);
    const first = (await store.events.findOne({ kind: "task.create" }))!.seq;
    await owner.post("/assign/tasks", { title: "Second" });
    const second = (await store.events.find({ kind: "task.create" }).sort({ seq: -1 }).limit(1).next())!.seq;
    const address = await app.listen({ host: "127.0.0.1", port: 0 });
    const read = async (lastId: string) => {
      const controller = new AbortController();
      try {
        const response = await fetch(`${address}/assign/events`, { headers: { cookie: owner.cookie(), "last-event-id": lastId }, signal: controller.signal });
        const reader = response.body!.getReader(); let body = "";
        for (let i = 0; i < 3 && !body.includes("data:"); i++) body += new TextDecoder().decode((await reader.read()).value);
        return body;
      } finally { controller.abort(); }
    };
    const replay = await read(String(first));
    expect(replay).toContain(`id: ${second}`);
    expect(replay).not.toContain(`id: ${first}`);
    expect(await read("999999")).toContain("event: reset");
    const account = (await store.owners.findOne({ email: "owner@example.com" }))!;
    await store.events.insertMany(Array.from({ length: 501 }, (_, i) => ({ ownerId: account._id, seq: second + i + 1, kind: "bulk", createdAt: new Date() })));
    expect(await read(String(first))).toContain("event: reset");
  });
  it("sends a live revoke to an open assignee stream", async () => {
    const owner = browser(); await owner.login("owner@example.com");
    await owner.post("/assign/lists", { name: "Work" });
    const store = await openAssignStore(db), list = (await store.lists.findOne({ name: "Work" }))!;
    await owner.post(`/assign/lists/${list._id}/assign`, { person: "Sam" });
    const assignment = (await store.assignments.findOne({ listId: list._id, active: true }))!;
    const address = await app.listen({ host: "127.0.0.1", port: 0 });
    const controller = new AbortController();
    try {
      const response = await fetch(`${address}/l/${assignment.code}/events`, { signal: controller.signal });
      expect(response.status).toBe(200);
      const reader = response.body!.getReader();
      expect((await app.inject({ method: "POST", url: `/l/${assignment.code}/view` })).statusCode).toBe(204);
      await owner.post(`/assign/lists/${list._id}/revoke`);
      let text = "";
      for (let i = 0; i < 4 && !text.includes("event: revoked"); i++) text += new TextDecoder().decode((await reader.read()).value);
      expect(text).toContain("event: revoked");
      expect(text).not.toContain("assignment.opened");
      expect((await reader.read()).done).toBe(true);
    } finally { controller.abort(); }
  });
  it("purges only expired tokens and old views, twice safely", async () => {
    const store = await openAssignStore(db), now = new Date("2026-11-12T00:00:00Z");
    const ownerId = new ObjectId(), assignmentId = new ObjectId();
    const view = (days: number) => ({ ownerId, assignmentId, viewedAt: new Date(now.getTime() - days * 86_400_000), userAgent: "Chrome", browser: "Chrome", deviceType: "desktop", counted: true });
    await store.views.insertMany([view(91), view(89)]);
    await store.loginTokens.insertMany([{ email: "a@x.com", tokenHash: "old", expiresAt: new Date(now.getTime() - 1000) }, { email: "b@x.com", tokenHash: "new", expiresAt: new Date(now.getTime() + 1000) }]);
    await store.refreshTokens.insertMany([{ ownerId, tokenHash: "old", family: "1", expiresAt: new Date(now.getTime() - 1000) }, { ownerId, tokenHash: "new", family: "2", expiresAt: new Date(now.getTime() + 1000) }]);
    const ctx = { store, config: loadAssignConfig({ PUBLIC_URL: "http://assign.test", ASSIGN_JWT_SECRET: "x".repeat(32) })!, mailer: { send: async () => {} }, now: () => now, limiter: createRateLimiter(() => now) };
    await purgeOld(ctx); await purgeOld(ctx);
    expect(await store.views.countDocuments()).toBe(1);
    expect(await store.loginTokens.countDocuments()).toBe(1);
    expect(await store.refreshTokens.countDocuments()).toBe(1);
  });
  it("records one List completion per done cycle and clears the activity badge", async () => {
    const owner = browser(); await owner.login("owner@example.com");
    await owner.post("/assign/tasks", { title: "A" });
    await owner.post("/assign/tasks", { title: "B" });
    const store = await openAssignStore(db), tasks = await store.tasks.find({}).toArray();
    await owner.post("/assign/lists", { name: "Checklist", taskIds: tasks.map(t => t._id.toHexString()) });
    const list = (await store.lists.findOne({ name: "Checklist" }))!;
    for (const task of tasks) await owner.post(`/assign/tasks/${task._id}/status`, { status: "done" });
    expect(await store.events.countDocuments({ listId: list._id, kind: "list.complete" })).toBe(1);
    await owner.post(`/assign/tasks/${tasks[0]!._id}/status`, { status: "open" });
    await owner.post(`/assign/tasks/${tasks[0]!._id}/status`, { status: "done" });
    expect(await store.events.countDocuments({ listId: list._id, kind: "list.complete" })).toBe(2);
    expect((await owner.get("/assign")).body).toMatch(/Activity \([1-9]/);
    await owner.get("/assign/feed");
    expect((await owner.get("/assign")).body).toContain("Activity (0 unread)");
  });
  it("refuses a 51st Task in a List", async () => {
    const owner = browser(); await owner.login("owner@example.com");
    const store = await openAssignStore(db), account = (await store.owners.findOne({ email: "owner@example.com" }))!, at = new Date();
    const docs = Array.from({ length: 51 }, (_, i) => ({ ownerId: account._id, title: `Task ${i}`, tags: [], instruction: "", note: "", blockedReason: "", status: "open" as const, createdAt: at, updatedAt: at }));
    await store.tasks.insertMany(docs);
    const tasks = await store.tasks.find({ ownerId: account._id }).toArray();
    expect((await owner.post("/assign/lists", { name: "Too many", taskIds: tasks.map(t => t._id.toHexString()) })).statusCode).toBe(400);
    expect((await owner.post("/assign/lists", { name: "Full", taskIds: tasks.slice(0, 50).map(t => t._id.toHexString()) })).statusCode).toBe(303);
    const list = (await store.lists.findOne({ name: "Full" }))!;
    expect((await owner.post(`/assign/lists/${list._id}/add`, { taskId: tasks[50]!._id.toHexString() })).statusCode).toBe(400);
    expect((await store.lists.findOne({ _id: list._id }))!.taskCount).toBe(50);
  });
  it("normalizes tags, escapes text, and requires a blocked reason", async () => {
    const owner = browser(); await owner.login("owner@example.com");
    const title = "<script>alert(1)</script>";
    expect((await owner.post("/assign/tasks", { title, tags: " Move,move, URGENT " })).statusCode).toBe(303);
    const store = await openAssignStore(db), task = (await store.tasks.findOne({ title }))!;
    expect(task.tags).toEqual(["move", "urgent"]);
    const html = (await owner.get("/assign/tasks")).body;
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain(title);
    expect((await owner.get("/assign/tasks?tag=move")).body).toContain("&lt;script&gt;");
    expect((await owner.post(`/assign/tasks/${task._id}/status`, { status: "blocked" })).statusCode).toBe(303);
    await owner.post(`/assign/tasks/${task._id}/note`, { note: "Need paint" });
    expect((await store.tasks.findOne({ _id: task._id }))!.note).toBe("Need paint");
    await owner.post(`/assign/tasks/${task._id}/status`, { status: "open" });
    expect((await store.tasks.findOne({ _id: task._id }))!.note).toBe("Need paint");
    expect((await owner.post("/assign/tasks", { title: "x".repeat(201) })).statusCode).toBe(400);
    await owner.post(`/assign/tasks/${task._id}/status`, { status: "done" });
    expect((await owner.get(`/assign/tasks/${task._id}`)).body).toContain('value="open">Reopen');
    const missing = await owner.get("/assign/tasks/000000000000000000000000");
    expect(missing.statusCode).toBe(404);
    expect(missing.headers["content-type"]).toContain("text/html");
    expect(missing.body).toContain("Go back");
  });
  it("explains deletions and removes Tasks and Lists from active links", async () => {
    const owner = browser(); await owner.login("owner@example.com");
    await owner.post("/assign/tasks", { title: "Carry" });
    const store = await openAssignStore(db), task = (await store.tasks.findOne({ title: "Carry" }))!;
    await owner.post("/assign/lists", { name: "Moving", taskIds: task._id.toHexString() });
    const list = (await store.lists.findOne({ name: "Moving" }))!;
    await owner.post(`/assign/lists/${list._id}/assign`, { person: "Omar" });
    const assignment = (await store.assignments.findOne({ listId: list._id, active: true }))!;
    expect((await owner.get(`/assign/tasks/${task._id}/delete`)).body).toContain("Omar's link");
    await owner.post(`/assign/tasks/${task._id}/delete`);
    expect((await app.inject({ method: "GET", url: `/l/${assignment.code}` })).body).toContain("Carry");
    const listPage = (await owner.get(`/assign/lists/${list._id}`)).body;
    expect(listPage).toMatch(/<dialog id="delete-list"[^>]*>.*Revokes 1 active link and returns 0 Tasks.*<form method="post" action="\/assign\/lists\/[a-f\d]{24}\/delete" class="actions"><input type="hidden" name="csrf"/s);
    expect((await owner.get(`/assign/lists/${list._id}/delete`)).body).toContain("Revokes 1 active link and");
    await owner.post(`/assign/lists/${list._id}/delete`);
    expect((await app.inject({ method: "GET", url: `/l/${assignment.code}` })).body).toContain("no longer available");
  });
  it("migrates old blocked reasons once and permits an empty Note", async () => {
    const owner = browser(); await owner.login("migration@example.com");
    const store = await openAssignStore(db), account = (await store.owners.findOne({ email: "migration@example.com" }))!;
    const now = new Date();
    const legacy = db.collection("ta_tasks");
    await legacy.insertMany(["both", "reason", "note", "neither"].map((title, index) => ({ ownerId: account._id, title, tags: [], instruction: "", note: index === 0 || index === 2 ? "old note" : "", ...(index < 2 ? { blockedReason: "old reason" } : {}), status: "open", createdAt: now, updatedAt: now })));
    await openAssignStore(db); await openAssignStore(db);
    expect((await store.tasks.findOne({ title: "both" }))!.note).toBe("old reason\n\nold note");
    expect((await store.tasks.findOne({ title: "reason" }))!.note).toBe("old reason");
    expect((await store.tasks.findOne({ title: "note" }))!.note).toBe("old note");
    expect((await store.tasks.findOne({ title: "neither" }))!.note).toBe("");
    const task = (await store.tasks.findOne({ title: "neither" }))!;
    expect((await owner.post(`/assign/tasks/${task._id}/status`, { status: "blocked" })).statusCode).toBe(303);
    expect((await store.tasks.findOne({ _id: task._id }))!.status).toBe("blocked");
  });
  it("creates and assigns selected Tasks, then tags additions and shows removals", async () => {
    const owner = browser(); await owner.login("selected@example.com");
    for (const title of ["Initial", "Later"]) await owner.post("/assign/tasks", { title });
    const store = await openAssignStore(db), initial = (await store.tasks.findOne({ title: "Initial" }))!, later = (await store.tasks.findOne({ title: "Later" }))!;
    const created = await owner.post("/assign/lists", { name: "Selected", taskIds: initial._id.toHexString(), person: "Sam" });
    expect(created.statusCode).toBe(303);
    const list = (await store.lists.findOne({ name: "Selected" }))!, assignment = (await store.assignments.findOne({ listId: list._id, active: true }))!;
    expect((await owner.get(`/assign/lists/${list._id}`)).body).toContain("Copy link");
    expect((await owner.post(`/assign/lists/${list._id}/add`, { taskId: later._id.toHexString() })).statusCode).toBe(303);
    expect((await owner.get(`/assign/lists/${list._id}`)).body).toContain("Additional task");
    expect((await app.inject({ method: "GET", url: `/l/${assignment.code}` })).body).toContain("Additional task");
    await owner.post(`/assign/lists/${list._id}/remove`, { taskId: later._id.toHexString() });
    const removed = (await app.inject({ method: "GET", url: `/l/${assignment.code}` })).body;
    expect(removed).toContain("Removed"); expect(removed).toContain("Later");
    await owner.post(`/assign/lists/${list._id}/add`, { taskId: later._id.toHexString() });
    expect((await store.lists.findOne({ _id: list._id }))!.removedTasks || []).toHaveLength(0);
  });
  it("distinguishes replaced and revoked links, including stale posts", async () => {
    const owner = browser(); await owner.login("links@example.com");
    await owner.post("/assign/lists", { name: "Private" });
    const store = await openAssignStore(db), list = (await store.lists.findOne({ name: "Private" }))!;
    await owner.post(`/assign/lists/${list._id}/assign`, { person: "A" });
    const first = (await store.assignments.findOne({ listId: list._id, active: true }))!;
    await owner.post(`/assign/lists/${list._id}/assign`, { person: "B" });
    const replaced = await app.inject({ method: "GET", url: `/l/${first.code}` });
    expect(replaced.body).toContain("replaced by a newer one"); expect(replaced.body).not.toContain("Private</h1>");
    const stale = await app.inject({ method: "POST", url: `/l/${first.code}/tasks/${new ObjectId()}/status`, headers: { "content-type": "application/x-www-form-urlencoded" }, payload: "status=done" });
    expect(stale.body).toContain("replaced by a newer one");
    const second = (await store.assignments.findOne({ listId: list._id, active: true }))!;
    await owner.post(`/assign/lists/${list._id}/revoke`);
    expect((await app.inject({ method: "GET", url: `/l/${second.code}` })).body).toContain("This List has been revoked");
  });
  it("stores an Owner-local date-only Deadline and marks only unfinished work overdue", async () => {
    const owner = browser(); await owner.login("deadlines@example.com");
    expect((await owner.post("/assign/tasks", { title: "Due", deadlineDate: "2020-01-02", timezoneOffset: "-240" })).statusCode).toBe(303);
    const store = await openAssignStore(db), task = (await store.tasks.findOne({ title: "Due" }))!;
    expect(task.deadline?.toISOString()).toBe("2020-01-02T19:59:00.000Z");
    expect((await owner.get("/assign/tasks")).body).toContain("Overdue");
    await owner.post(`/assign/tasks/${task._id}/status`, { status: "done" });
    expect((await owner.get("/assign/tasks")).body).not.toContain("Overdue");
    const invalid = await owner.post("/assign/tasks", { title: "Bad", deadlineDate: "2020-99-99" });
    expect(invalid.statusCode).toBe(400); expect(invalid.body).toContain("data-reopen"); expect(invalid.body).toContain("Bad");
  });

  it("sends added and removed Task notices only after assignment", async () => {
    const owner = browser(); await owner.login("notices@example.com");
    for (const title of ["Base", "Extra"]) await owner.post("/assign/tasks", { title });
    const store = await openAssignStore(db), base = (await store.tasks.findOne({ title: "Base" }))!, extra = (await store.tasks.findOne({ title: "Extra" }))!;
    await owner.post("/assign/lists", { name: "Notices", taskIds: base._id.toHexString() });
    const list = (await store.lists.findOne({ name: "Notices" }))!;
    await owner.post(`/assign/lists/${list._id}/add`, { taskId: extra._id.toHexString() });
    expect(await store.events.countDocuments({ listId: list._id, kind: "list.add" })).toBe(0);
    await owner.post(`/assign/lists/${list._id}/assign`, { person: "Sam" });
    await owner.post(`/assign/lists/${list._id}/remove`, { taskId: extra._id.toHexString() });
    const assignment = (await store.assignments.findOne({ listId: list._id, active: true }))!;
    const address = await app.listen({ host: "127.0.0.1", port: 0 });
    const controller = new AbortController();
    try {
      const response = await fetch(`${address}/l/${assignment.code}/events`, { signal: controller.signal });
      const reader = response.body!.getReader();
      await owner.post(`/assign/lists/${list._id}/add`, { taskId: extra._id.toHexString() });
      let added = "";
      for (let j = 0; j < 3 && !added.includes("New Task added"); j++) added += new TextDecoder().decode((await reader.read()).value);
      expect(added).toContain("New Task added: Extra");
      await owner.post(`/assign/lists/${list._id}/remove`, { taskId: extra._id.toHexString() });
      let removed = "";
      for (let j = 0; j < 3 && !removed.includes("Task removed"); j++) removed += new TextDecoder().decode((await reader.read()).value);
      expect(removed).toContain("Task removed: Extra");
      expect((await owner.get("/assign/feed")).body).toContain("Added Extra to Notices");
    } finally { controller.abort(); }
  });

});
