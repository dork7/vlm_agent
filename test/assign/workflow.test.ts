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
  let mongo: MongoMemoryServer, client: MongoClient, db: Db, app: ReturnType<typeof Fastify>, serverAddress: string | undefined;
  const mail: string[] = [];
  beforeAll(async () => { mongo = await MongoMemoryServer.create(); client = await MongoClient.connect(mongo.getUri()); });
  beforeEach(async () => {
    mail.length = 0; serverAddress = undefined; db = client.db(`workflow_${crypto.randomUUID()}`); app = Fastify({ logger: false });
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
  const FORM_HEADERS = { "content-type": "application/x-www-form-urlencoded" };
  // Assignee-style form POST (no Owner session or CSRF), by payload object or raw string.
  const postForm = (url: string, payload: Record<string, string> | string = {}) => app.inject({ method: "POST", url, headers: FORM_HEADERS, payload: typeof payload === "string" ? payload : new URLSearchParams(payload).toString() });
  type Store = Awaited<ReturnType<typeof openAssignStore>>;
  // The live copy a Template produced (copies are what Assignees and Owners change status on).
  const copyFor = async (store: Store, template: { _id: ObjectId }) => (await store.tasks.findOne({ templateId: template._id, kind: "copy", deletedAt: { $exists: false } }))!;
  // Link code of the List's active Assignment.
  const activeCode = async (store: Store, listId: ObjectId) => (await store.assignments.findOne({ listId, active: true }))!.code;
  // Logs in a fresh Owner and creates one Task per title.
  async function seedTasks(email: string, titles: string[]) {
    const owner = browser(); await owner.login(email);
    for (const title of titles) await owner.post("/assign/tasks", { title });
    const store = await openAssignStore(db);
    // task/id resolve to the live copy once the Template has been added to a List (copies sort before "template"); tid is always the Template.
    const task = async (title: string) => (await store.tasks.findOne({ title, deletedAt: { $exists: false } }, { sort: { kind: 1 } }))!;
    const id = async (title: string) => (await task(title))._id.toHexString();
    const tid = async (title: string) => (await store.tasks.findOne({ title, kind: "template" }))!._id.toHexString();
    return { owner, store, task, id, tid };
  }
  // Opens an SSE stream on the test server; readUntil collects text until the needle shows up.
  async function openStream(path: string, headers: Record<string, string> = {}) {
    serverAddress ??= await app.listen({ host: "127.0.0.1", port: 0 });
    const controller = new AbortController();
    const response = await fetch(`${serverAddress}${path}`, { headers, signal: controller.signal });
    const reader = response.body!.getReader();
    const readUntil = async (needle: string, attempts = 4) => {
      let text = "";
      for (let attempt = 0; attempt < attempts && !text.includes(needle); attempt++) {
        const chunk = await Promise.race([reader.read(), new Promise<never>((_, reject) => setTimeout(() => reject(new Error("SSE timeout")), 3000))]);
        text += new TextDecoder().decode(chunk.value);
      }
      return text;
    };
    return { response, reader, readUntil, close: () => controller.abort() };
  }
  it("builds a List, gives one scoped link, and revokes it", async () => {
    const owner = browser(); await owner.login("owner@example.com");
    expect((await owner.post("/assign/tasks", { title: "Pack books", tags: "move" })).statusCode).toBe(303);
    const store = await openAssignStore(db); const template = (await store.tasks.findOne({ title: "Pack books" }))!;
    const listReply = await owner.post("/assign/lists", { name: "Move-out", taskIds: template._id.toHexString() });
    expect(listReply.statusCode).toBe(303);
    const task = await copyFor(store, template);
    const list = (await store.lists.findOne({ name: "Move-out" }))!;
    expect((await owner.post(`/assign/lists/${list._id}/assign`, { person: "Omar" })).statusCode).toBe(303);
    const assignment = (await store.assignments.findOne({ listId: list._id, active: true }))!;
    const link = `/l/${assignment.code}`;
    expect((await app.inject({ method: "GET", url: link })).body).toContain("Pack books");
    expect((await postForm(`${link}/tasks/${task._id}/status`, "status=done")).statusCode).toBe(303);
    expect((await store.tasks.findOne({ _id: task._id }))!.status).toBe("done");
    expect((await owner.get("/assign")).body).toContain("1 of 1 done");
    await owner.post(`/assign/lists/${list._id}/revoke`);
    expect((await app.inject({ method: "GET", url: link })).body).toContain("no longer available");
  });
  it("keeps tag filtering and Task links on the Templates column", async () => {
    const owner = browser(); await owner.login("layouts@example.com");
    await owner.post("/assign/tasks", { title: "Pack books", tags: "move" });
    await owner.post("/assign/tasks", { title: "Paint wall", tags: "repair" });
    const store = await openAssignStore(db);
    const task = (await store.tasks.findOne({ title: "Pack books" }))!;
    const html = (await owner.get("/assign/tasks?tag=move")).body;
    expect(html).toContain(`href="/assign/tasks/${task._id}"`);
    expect(html).toContain('name="tag" value="move"');
    expect(html).not.toContain("Paint wall");
    const empty = (await owner.get("/assign/tasks?tag=missing")).body;
    expect(empty).toContain("No Tasks tagged");
    expect(empty).not.toContain("Pack books");
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
    const stale = await postForm(`${url}/tasks/${task._id}/status`, "status=done");
    expect(stale.statusCode).toBe(404);
  });
  it("streams a saved change to the Owner", async () => {
    const owner = browser(); await owner.login("owner@example.com");
    const stream = await openStream("/assign/events", { cookie: owner.cookie() });
    try {
      expect(stream.response.status).toBe(200);
      await owner.post("/assign/tasks", { title: "Live Task" });
      expect(await stream.readUntil("task.create", 3)).toContain("task.create");
    } finally { stream.close(); }
  });
  it("shows the occupied List and reuses a Person by case", async () => {
    const owner = browser(); await owner.login("owner@example.com");
    await owner.post("/assign/tasks", { title: "Paint wall" });
    const store = await openAssignStore(db); const task = (await store.tasks.findOne({ title: "Paint wall" }))!;
    await owner.post("/assign/lists", { name: "Room", taskIds: task._id.toHexString() });
    expect((await owner.get("/assign/tasks")).body).toMatch(/Paint wall[\s\S]*?in 1 list/);
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
    const read = async (lastId: string) => {
      const stream = await openStream("/assign/events", { cookie: owner.cookie(), "last-event-id": lastId });
      try { return await stream.readUntil("data:", 3); } finally { stream.close(); }
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
    const stream = await openStream(`/l/${assignment.code}/events`);
    try {
      expect(stream.response.status).toBe(200);
      expect((await app.inject({ method: "POST", url: `/l/${assignment.code}/view` })).statusCode).toBe(204);
      await owner.post(`/assign/lists/${list._id}/revoke`);
      const text = await stream.readUntil("event: revoked");
      expect(text).toContain("event: revoked");
      expect(text).not.toContain("assignment.opened");
      expect((await stream.reader.read()).done).toBe(true);
    } finally { stream.close(); }
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
    const store = await openAssignStore(db), templates = await store.tasks.find({}).toArray();
    await owner.post("/assign/lists", { name: "Checklist", taskIds: templates.map(task => task._id.toHexString()) });
    const list = (await store.lists.findOne({ name: "Checklist" }))!;
    const tasks = await store.tasks.find({ listId: list._id }).toArray();
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
    const docs = Array.from({ length: 51 }, (_, i) => ({ ownerId: account._id, title: `Task ${i}`, tags: [], instruction: "", note: "", blockedReason: "", kind: "template" as const, status: "open" as const, createdAt: at, updatedAt: at }));
    await store.tasks.insertMany(docs);
    const tasks = await store.tasks.find({ ownerId: account._id }).toArray();
    expect((await owner.post("/assign/lists", { name: "Too many", taskIds: tasks.map(task => task._id.toHexString()) })).statusCode).toBe(400);
    expect((await owner.post("/assign/lists", { name: "Full", taskIds: tasks.slice(0, 50).map(task => task._id.toHexString()) })).statusCode).toBe(303);
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
    const store = await openAssignStore(db), template = (await store.tasks.findOne({ title: "Carry" }))!;
    await owner.post("/assign/lists", { name: "Moving", taskIds: template._id.toHexString() });
    const list = (await store.lists.findOne({ name: "Moving" }))!, task = await copyFor(store, template);
    await owner.post(`/assign/lists/${list._id}/assign`, { person: "Omar" });
    const assignment = (await store.assignments.findOne({ listId: list._id, active: true }))!;
    expect((await owner.get(`/assign/tasks/${task._id}/delete`)).body).toContain("Omar's link");
    await owner.post(`/assign/tasks/${task._id}/delete`);
    expect((await app.inject({ method: "GET", url: `/l/${assignment.code}` })).body).toContain("Carry");
    const listPage = (await owner.get("/assign/tasks")).body;
    expect(listPage).toMatch(/<dialog id="delete-list-[a-f\d]{24}"[^>]*>.*Revokes 1 active link and returns 0 Tasks.*<form method="post" action="\/assign\/lists\/[a-f\d]{24}\/delete" class="actions"><input type="hidden" name="csrf"/s);
    expect((await owner.get(`/assign/lists/${list._id}/delete`)).body).toContain("Revokes 1 active link and");
    await owner.post(`/assign/lists/${list._id}/delete`);
    expect((await app.inject({ method: "GET", url: `/l/${assignment.code}` })).body).toContain("no longer available");
    expect((await store.tasks.findOne({ _id: template._id }))!.deletedAt).toBeUndefined();
  });
  it("retains a deleted List's copies with reason list-deleted and keeps the Template", async () => {
    const { owner, store, id, tid } = await seedTasks("copy-listdel@example.com", ["Keep me"]);
    await owner.post("/assign/lists", { name: "Doomed", taskIds: await tid("Keep me") });
    const list = (await store.lists.findOne({ name: "Doomed" }))!, copy = (await store.tasks.findOne({ listId: list._id }))!;
    await owner.post(`/assign/lists/${list._id}/delete`);
    expect((await store.tasks.findOne({ _id: copy._id }))!.deleteReason).toBe("list-deleted");
    expect((await store.tasks.findOne({ _id: await tid("Keep me").then(x => new ObjectId(x)) }))!.deletedAt).toBeUndefined();
    expect(await id("Keep me")).toBe(await tid("Keep me"));
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
  it("backfills Task kind once: listed Tasks become copies, unlisted become templates", async () => {
    const owner = browser(); await owner.login("kind@example.com");
    const store = await openAssignStore(db), account = (await store.owners.findOne({ email: "kind@example.com" }))!;
    const now = new Date(), listId = new ObjectId();
    await db.collection("ta_tasks").insertMany([{ title: "listed", listId }, { title: "free" }].map(t => ({ ownerId: account._id, tags: [], instruction: "", note: "", status: "open", createdAt: now, updatedAt: now, ...t })));
    await openAssignStore(db); await openAssignStore(db);
    const listed = (await store.tasks.findOne({ title: "listed" }))!, free = (await store.tasks.findOne({ title: "free" }))!;
    expect(listed.kind).toBe("copy"); expect(listed.listId).toEqual(listId);
    expect(free.kind).toBe("template"); expect(free.listId).toBeUndefined();
  });
  it("keeps Task kind in step with List membership in the existing flows", async () => {
    const owner = browser(); await owner.login("kind2@example.com");
    await owner.post("/assign/tasks", { title: "Solo" });
    const store = await openAssignStore(db), template = (await store.tasks.findOne({ title: "Solo" }))!;
    expect(template.kind).toBe("template");
    await owner.post("/assign/lists", { name: "L", taskIds: template._id.toHexString() });
    const list = (await store.lists.findOne({ name: "L" }))!, copy = await copyFor(store, template);
    expect(copy.kind).toBe("copy"); expect((await store.tasks.findOne({ _id: template._id }))!.kind).toBe("template");
    await owner.post(`/assign/lists/${list._id}/remove`, { taskId: copy._id.toHexString() });
    expect((await store.tasks.findOne({ _id: copy._id }))!.deleteReason).toBe("removed");
    expect((await store.tasks.findOne({ _id: template._id }))!.deletedAt).toBeUndefined();
  });
  it("lets an Assignee block without a Note and shows the Note wherever the reason appeared", async () => {
    const owner = browser(); await owner.login("blocknote@example.com");
    await owner.post("/assign/tasks", { title: "Stuck" }); await owner.post("/assign/tasks", { title: "Jammed" });
    const store = await openAssignStore(db), stuckT = (await store.tasks.findOne({ title: "Stuck" }))!, jammedT = (await store.tasks.findOne({ title: "Jammed" }))!;
    await owner.post("/assign/lists", { name: "Jobs", taskIds: [stuckT._id.toHexString(), jammedT._id.toHexString()], person: "Lena" });
    const stuck = await copyFor(store, stuckT), jammed = await copyFor(store, jammedT);
    const assignment = (await store.assignments.findOne({ active: true }))!;
    const link = `/l/${assignment.code}`;
    expect((await postForm(`${link}/tasks/${stuck._id}/status`, "status=blocked")).statusCode).toBe(303);
    expect((await store.tasks.findOne({ _id: stuck._id }))!.status).toBe("blocked");
    await postForm(`${link}/tasks/${jammed._id}/status`, "status=blocked&note=Waiting+for+keys");
    expect((await app.inject({ method: "GET", url: link })).body).toContain("Waiting for keys");
    expect((await owner.get("/assign")).body).toContain("Waiting for keys");
    expect((await owner.get(`/assign/tasks/${jammed._id}`)).body).toContain("Waiting for keys");
    expect(await store.tasks.countDocuments({ blockedReason: { $exists: true } })).toBe(0);
  });
  describe("Create List from selection and the Lists sidebar", () => {
    it("creates a Draft List without a Person and records no first assignment", async () => {
      const { owner, store, id, tid } = await seedTasks("draft@example.com", ["A", "B"]);
      const reply = await owner.post("/assign/lists", { name: "Prep", taskIds: [await tid("A"), await tid("B")] });
      const list = (await store.lists.findOne({ name: "Prep" }))!;
      expect(reply.headers.location).toBe(`/assign/tasks?list=${list._id}#list-${list._id}`);
      expect(list.status).toBe("draft"); expect(list.firstAssignedAt).toBeUndefined();
      expect(await store.assignments.countDocuments({ listId: list._id })).toBe(0);
      expect(await store.tasks.countDocuments({ listId: list._id })).toBe(2);
    });
    it("creates List and Assignment together, records first assignment once, and tags nothing as Additional", async () => {
      const { owner, store, id, tid } = await seedTasks("assign@example.com", ["A"]);
      const reply = await owner.post("/assign/lists", { name: "Go", taskIds: await tid("A"), person: "Nadia" });
      const list = (await store.lists.findOne({ name: "Go" }))!;
      expect(reply.headers.location).toBe(`/assign/tasks?list=${list._id}#list-${list._id}`);
      const first = list.firstAssignedAt; expect(first).toBeInstanceOf(Date); expect(list.status).toBe("active");
      expect(await store.assignments.countDocuments({ listId: list._id, active: true })).toBe(1);
      expect((await owner.get("/assign/tasks")).body).not.toContain("Additional task");
      await owner.post(`/assign/lists/${list._id}/assign`, { person: "Other" });
      expect((await store.lists.findOne({ _id: list._id }))!.firstAssignedAt).toEqual(first);
    });
    it("leaves no List, Assignment or attached Task when creation is rejected", async () => {
      const { owner, store, id: idOf } = await seedTasks("atomic@example.com", ["A", "B"]);
      const idA = await idOf("A"), idB = await idOf("B");
      expect((await owner.post("/assign/lists", { name: "Bad", taskIds: idA, person: "x".repeat(201) })).statusCode).toBe(400);
      expect(await store.lists.countDocuments({})).toBe(0); expect(await store.assignments.countDocuments({})).toBe(0); expect(await store.people.countDocuments({})).toBe(0);
      expect(await store.tasks.countDocuments({ kind: "copy" })).toBe(0);
      await owner.post("/assign/lists", { name: "First", taskIds: idA });
      const again = await owner.post("/assign/lists", { name: "Second", taskIds: [idB, "0".repeat(24)], person: "Sam" });
      expect(again.statusCode).toBe(404);
      expect(await store.lists.countDocuments({})).toBe(1); expect(await store.assignments.countDocuments({})).toBe(0); expect(await store.people.countDocuments({})).toBe(0);
      expect(await store.tasks.countDocuments({ kind: "copy" })).toBe(1);
      const copy = (await store.tasks.findOne({ kind: "copy" }))!;
      expect((await owner.post("/assign/lists", { name: "Third", taskIds: copy._id.toHexString() })).statusCode).toBe(400);
      expect(await store.lists.countDocuments({})).toBe(1);
    });
    it("keeps Templates selectable after they were added to a List and labels how many Lists hold them", async () => {
      const { owner, tid } = await seedTasks("disabled@example.com", ["Taken", "Free"]);
      await owner.post("/assign/lists", { name: "Mine", taskIds: await tid("Taken") });
      const html = (await owner.get("/assign/tasks")).body;
      expect(html).not.toMatch(/<input type="checkbox"[^>]*disabled/);
      expect(html).toMatch(/Taken[\s\S]*?in 1 list/);
      expect(html).toMatch(/Free[\s\S]*?in 0 lists/);
      expect(html.match(/name="taskIds"[^>]*form="select-tasks"/g)).toHaveLength(2);
    });
    it("renders every List in the labelled Lists panel with pill and done count, kept current", async () => {
      const { owner, store, tid } = await seedTasks("sidebar@example.com", ["A", "B", "C"]);
      await owner.post("/assign/lists", { name: "Drafty", taskIds: await tid("C") });
      await owner.post("/assign/lists", { name: "Sent", taskIds: [await tid("A"), await tid("B")], person: "Zed" });
      const taskA = (await store.tasks.findOne({ title: "A", kind: "copy" }))!;
      await owner.post(`/assign/tasks/${taskA._id}/status`, { status: "done" });
      const html = (await owner.get("/assign/tasks")).body;
      const panel = html.match(/<aside[^>]*class="lists-panel"[\s\S]*?<\/aside>/)![0];
      expect(panel).toMatch(/aria-labelledby=/);
      expect(panel).toMatch(/Sent[\s\S]*?Zed[\s\S]*?value="1" max="2"[\s\S]*?2 tasks/);
      expect(panel).toMatch(/Drafty[\s\S]*?Not shared[\s\S]*?value="0" max="1"[\s\S]*?1 task\b/);
      expect(html).toContain("new EventSource");
    });
  });
  it("creates and assigns selected Tasks, then tags additions and shows removals", async () => {
    const owner = browser(); await owner.login("selected@example.com");
    for (const title of ["Initial", "Later"]) await owner.post("/assign/tasks", { title });
    const store = await openAssignStore(db), initial = (await store.tasks.findOne({ title: "Initial" }))!, later = (await store.tasks.findOne({ title: "Later" }))!;
    const created = await owner.post("/assign/lists", { name: "Selected", taskIds: initial._id.toHexString(), person: "Sam" });
    expect(created.statusCode).toBe(303);
    const list = (await store.lists.findOne({ name: "Selected" }))!, assignment = (await store.assignments.findOne({ listId: list._id, active: true }))!;
    expect((await owner.get("/assign/tasks")).body).toContain("Copy link");
    expect((await owner.post(`/assign/lists/${list._id}/add`, { taskId: later._id.toHexString() })).statusCode).toBe(303);
    expect((await owner.get("/assign/tasks")).body).toContain("Additional task");
    expect((await app.inject({ method: "GET", url: `/l/${assignment.code}` })).body).toContain("Additional task");
    await owner.post(`/assign/lists/${list._id}/remove`, { taskId: (await copyFor(store, later))._id.toHexString() });
    const removed = (await app.inject({ method: "GET", url: `/l/${assignment.code}` })).body;
    expect(removed).toContain("Removed"); expect(removed).toContain("Later");
    await owner.post(`/assign/lists/${list._id}/add`, { taskId: later._id.toHexString() });
    expect(await store.tasks.countDocuments({ title: "Later", kind: "copy", listId: list._id, deletedAt: { $exists: false } })).toBe(1);
  });
  it("creates one link with no Person, asks for a name on first open only, and shows it on the Board", async () => {
    const { owner, store, id } = await seedTasks("nameless@example.com", ["Water plants"]);
    await owner.post("/assign/lists", { name: "Chores", taskIds: [await id("Water plants")] });
    const list = (await store.lists.findOne({ name: "Chores" }))!;
    const first = await owner.post(`/assign/lists/${list._id}/link`);
    expect(first.statusCode).toBe(200);
    const url = (first.json() as { url: string }).url;
    expect(url).toMatch(/^http:\/\/assign\.test\/l\/[A-Za-z0-9]{10}$/);
    const again = await owner.post(`/assign/lists/${list._id}/link`);
    expect((again.json() as { url: string }).url).toBe(url);
    expect(await store.assignments.countDocuments({ listId: list._id })).toBe(1);
    expect(await store.people.countDocuments({})).toBe(0);
    expect((await owner.get("/assign")).body).toContain("Awaiting name");
    expect((await owner.get("/assign/tasks")).body).toContain("Copy link");
    const path = new URL(url).pathname;
    const firstOpen = await app.inject({ method: "GET", url: path });
    expect(firstOpen.body).toContain('name="person"'); expect(firstOpen.body).not.toContain("Water plants");
    expect((await postForm(`${path}/name`, { person: "   " })).statusCode).toBe(400);
    expect((await postForm(`${path}/name`, { person: "Sam" })).statusCode).toBe(303);
    const laterOpen = await app.inject({ method: "GET", url: path, headers: { "user-agent": "another device" } });
    expect(laterOpen.body).toContain("Water plants"); expect(laterOpen.body).not.toContain('name="person"');
    const second = await postForm(`${path}/name`, { person: "Mallory" });
    expect(second.statusCode).toBe(303); expect(await store.people.countDocuments({})).toBe(1);
    const board = (await owner.get("/assign")).body;
    expect(board).toContain("Sam"); expect(board).not.toContain("Awaiting name"); expect(board).not.toContain("Mallory");
  });
  it("replaces an unassigned link through Reassign", async () => {
    const owner = browser(); await owner.login("reassign@example.com");
    await owner.post("/assign/lists", { name: "Open" });
    const store = await openAssignStore(db), list = (await store.lists.findOne({ name: "Open" }))!;
    const oldPath = new URL(((await owner.post(`/assign/lists/${list._id}/link`)).json() as { url: string }).url).pathname;
    await owner.post(`/assign/lists/${list._id}/assign`, { person: "Zed" });
    expect((await app.inject({ method: "GET", url: oldPath })).body).toContain("replaced by a newer one");
    const newer = (await store.assignments.findOne({ listId: list._id, active: true }))!;
    expect(`/l/${newer.code}`).not.toBe(oldPath); expect(newer.personId).toBeDefined();
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
    const stale = await postForm(`/l/${first.code}/tasks/${new ObjectId()}/status`, "status=done");
    expect(stale.body).toContain("replaced by a newer one");
    const second = (await store.assignments.findOne({ listId: list._id, active: true }))!;
    await owner.post(`/assign/lists/${list._id}/revoke`);
    expect((await app.inject({ method: "GET", url: `/l/${second.code}` })).body).toContain("This List has been revoked");
  });
  it("shows the revoked message, with no Task details, on every inactive-link action and after List or Person deletion", async () => {
    const owner = browser(); await owner.login("inactive@example.com");
    await owner.post("/assign/tasks", { title: "Secret errand" }); await owner.post("/assign/tasks", { title: "Other errand" });
    const store = await openAssignStore(db);
    const revoked = "This List has been revoked. Ask the person who sent it for a new link.";
    for (const [i, how] of ["revoke", "deleteList", "deletePerson"].entries()) {
      await owner.post("/assign/lists", { name: `Hidden${i}` });
      const list = (await store.lists.findOne({ name: `Hidden${i}` }))!, task = (await store.tasks.findOne({ title: "Secret errand" }))!;
      await owner.post(`/assign/lists/${list._id}/add`, { taskId: task._id.toHexString() });
      await owner.post(`/assign/lists/${list._id}/assign`, { person: `Pat${i}` });
      const link = (await store.assignments.findOne({ listId: list._id, active: true }))!;
      if (how === "revoke") await owner.post(`/assign/lists/${list._id}/revoke`);
      else if (how === "deleteList") await owner.post(`/assign/lists/${list._id}/delete`);
      else await owner.post(`/assign/people/${link.personId}/delete`);
      const page = await app.inject({ method: "GET", url: `/l/${link.code}` });
      expect(page.body).toContain(revoked); expect(page.body).not.toContain("Secret errand"); expect(page.body).not.toContain("replaced");
      for (const action of [`tasks/${task._id}/status`, `tasks/${task._id}/note`, "view"]) {
        const res = await postForm(`/l/${link.code}/${action}`, "status=done&note=x");
        expect(res.statusCode).toBe(200); expect(res.body).toContain(revoked); expect(res.body).not.toContain("Secret errand");
      }
      expect((await store.tasks.findOne({ _id: task._id }))!.status).not.toBe("done");
    }
  });
  it("calls a revoked link revoked even after the List is assigned again", async () => {
    const owner = browser(); await owner.login("again@example.com");
    await owner.post("/assign/lists", { name: "Again" });
    const store = await openAssignStore(db), list = (await store.lists.findOne({ name: "Again" }))!;
    await owner.post(`/assign/lists/${list._id}/assign`, { person: "A" });
    const first = (await store.assignments.findOne({ listId: list._id, active: true }))!;
    await owner.post(`/assign/lists/${list._id}/revoke`);
    await owner.post(`/assign/lists/${list._id}/assign`, { person: "B" });
    const body = (await app.inject({ method: "GET", url: `/l/${first.code}` })).body;
    expect(body).toContain("This List has been revoked"); expect(body).not.toContain("replaced");
  });
  it("stores an Owner-local date-only Deadline and marks only unfinished work overdue", async () => {
    const owner = browser(); await owner.login("deadlines@example.com");
    expect((await owner.post("/assign/tasks", { title: "Due", deadlineDate: "2020-01-02", timezoneOffset: "-240" })).statusCode).toBe(303);
    const store = await openAssignStore(db), task = (await store.tasks.findOne({ title: "Due" }))!;
    expect(task.deadline?.toISOString()).toBe("2020-01-02T19:59:00.000Z");
    expect((await owner.get("/assign/tasks")).body).not.toContain("Overdue"); // a Template is never overdue
    await owner.post("/assign/lists", { name: "Due list", taskIds: task._id.toHexString() });
    expect((await owner.get("/assign/tasks")).body).toContain("Overdue");
    await owner.post(`/assign/tasks/${(await copyFor(store, task))._id}/status`, { status: "done" });
    expect((await owner.get("/assign/tasks")).body).not.toContain("Overdue");
    const invalid = await owner.post("/assign/tasks", { title: "Bad", deadlineDate: "2020-99-99" });
    expect(invalid.statusCode).toBe(400); expect(invalid.body).toContain("data-reopen"); expect(invalid.body).toContain("Bad");
  });

  describe("Add Task dialog and Deadline", () => {
    async function dueTask(deadline = { deadlineDate: "2020-01-02", deadlineTime: "09:30", timezoneOffset: "-240" }) {
      const owner = browser(); await owner.login(`due-${crypto.randomUUID()}@example.com`);
      await owner.post("/assign/tasks", { title: "Due", ...deadline });
      const store = await openAssignStore(db), template = (await store.tasks.findOne({ title: "Due" }))!;
      await owner.post("/assign/lists", { name: "L", taskIds: template._id.toHexString() });
      const list = (await store.lists.findOne({ name: "L" }))!, task = await copyFor(store, template);
      await owner.post(`/assign/lists/${list._id}/assign`, { person: "Omar" });
      const assignment = (await store.assignments.findOne({ listId: list._id, active: true }))!;
      // The Owner's board row for the copy (the Template is never done, so it would stay Overdue).
      const ownerRow = async () => ((await owner.get("/assign/tasks")).body.split('<li class="copy-item').find((part: string) => part.includes(`/assign/tasks/${task._id}`)) || "");
      return { owner, store, task, ownerRow, link: `/l/${assignment.code}` };
    }
    it("offers a quick-add row with Title, and Tags, Instructions and Deadline under More fields", async () => {
      const owner = browser(); await owner.login("dialog@example.com");
      const body = (await owner.get("/assign/tasks")).body;
      const form = body.match(/<form class="quick-add"[\s\S]*?<\/form>/)![0];
      for (const name of ["title", "tags", "instruction", "deadlineDate", "deadlineTime", "timezoneOffset"]) expect(form).toContain(`name="${name}"`);
      expect(form).toContain('maxlength="200"'); expect(form).toContain('maxlength="2000"');
      expect(form).toMatch(/<details class="more-fields">/);
    });
    it("keeps an explicit time as the Owner's local time and rejects unparseable Deadlines", async () => {
      const owner = browser(); await owner.login("explicit@example.com");
      await owner.post("/assign/tasks", { title: "Timed", deadlineDate: "2099-03-04", deadlineTime: "09:30", timezoneOffset: "-120" });
      const store = await openAssignStore(db);
      expect((await store.tasks.findOne({ title: "Timed" }))!.deadline!.toISOString()).toBe("2099-03-04T07:30:00.000Z");
      for (const bad of <Record<string, string>[]>[{ deadlineDate: "tomorrow" }, { deadlineDate: "2099-02-30" }, { deadlineTime: "10:00" }, { deadlineDate: "2099-01-01", timezoneOffset: "abc" }]) {
        const res = await owner.post("/assign/tasks", { title: "Nope", ...bad });
        expect(res.statusCode).toBe(400);
      }
      expect(await store.tasks.countDocuments({ title: "Nope" })).toBe(0);
    });
    it("reopens the dialog with the entered input and the error", async () => {
      const owner = browser(); await owner.login("reopen@example.com");
      const res = await owner.post("/assign/tasks", { title: "Keep me", tags: "a, b", instruction: "Do it", deadlineDate: "2099-02-30" });
      expect(res.statusCode).toBe(400);
      expect(res.body).toContain("data-reopen"); expect(res.body).toContain("Invalid Deadline");
      for (const kept of ['value="Keep me"', 'value="a, b"', ">Do it</textarea>", 'value="2099-02-30"']) expect(res.body).toContain(kept);
    });
    it("shows the Deadline as one instant to Assignee and Owner, Overdue only while not Done", async () => {
      const { owner, task, link, ownerRow } = await dueTask();
      expect((await app.inject({ method: "GET", url: link })).body).toContain('datetime="2020-01-02T05:30:00.000Z"');
      for (const body of [(await app.inject({ method: "GET", url: link })).body, await ownerRow()]) expect(body).toContain("Overdue");
      await owner.post(`/assign/tasks/${task._id}/status`, { status: "done" });
      for (const body of [(await app.inject({ method: "GET", url: link })).body, await ownerRow()]) expect(body).not.toContain("Overdue");
    });
    it("marks an Overdue Task in the collapsed summary and the board row, never a Done one", async () => {
      const { owner, task, link, ownerRow } = await dueTask();
      const summaryOf = (body: string) => body.match(/<summary>[\s\S]*?<\/summary>/)?.[0] ?? body.match(/<span class="copy-main">[\s\S]*?<\/span>/)![0];
      for (const body of [(await app.inject({ method: "GET", url: link })).body, await ownerRow()]) {
        expect(summaryOf(body)).toContain("Overdue"); expect(summaryOf(body)).toMatch(/class="[^"]*overdue/);
      }
      await owner.post(`/assign/tasks/${task._id}/status`, { status: "done" });
      for (const body of [(await app.inject({ method: "GET", url: link })).body, await ownerRow()]) expect(summaryOf(body)).not.toContain("Overdue");
    });
    it("reveals the Blocked Note first by cancelling the button's submit, and still posts status=blocked without script", async () => {
      const { link } = await dueTask();
      const body = (await app.inject({ method: "GET", url: link })).body;
      expect(body).toContain('<button name="status" value="blocked" data-block>Blocked</button>');
      expect(body).toMatch(/closest\('\[data-block\]'\);if\(!b\)return;e\.preventDefault\(\)/);
      expect(body).toMatch(/<div data-block-note hidden>[\s\S]*?<button name="status" value="blocked">Save Blocked<\/button>/);
    });
    it("lets the Owner change and clear a Deadline but not the Assignee", async () => {
      const { owner, store, task, link } = await dueTask();
      const base = { title: "Due", tags: "", instruction: "" };
      expect((await owner.post(`/assign/tasks/${task._id}/edit`, { ...base, deadlineDate: "2099-05-06", deadlineTime: "08:00", timezoneOffset: "0" })).statusCode).toBe(303);
      expect((await store.tasks.findOne({ _id: task._id }))!.deadline!.toISOString()).toBe("2099-05-06T08:00:00.000Z");
      expect((await owner.post(`/assign/tasks/${task._id}/edit`, { ...base, deadlineDate: "nope" })).statusCode).toBe(400);
      expect((await store.tasks.findOne({ _id: task._id }))!.deadline!.toISOString()).toBe("2099-05-06T08:00:00.000Z");
      const post = (path: string, payload: Record<string, string>) => postForm(`${link}${path}`, payload);
      await post(`/tasks/${task._id}/status`, { status: "blocked", deadlineDate: "2001-01-01" });
      await post(`/tasks/${task._id}/note`, { note: "hi", deadline: "2001-01-01", deadlineDate: "2001-01-01" });
      for (const path of [`/tasks/${task._id}/edit`, `/tasks/${task._id}/deadline`]) expect((await post(path, { title: "X", deadlineDate: "2001-01-01" })).statusCode).toBeGreaterThanOrEqual(400);
      const after = (await store.tasks.findOne({ _id: task._id }))!;
      expect(after.deadline!.toISOString()).toBe("2099-05-06T08:00:00.000Z"); expect(after.title).toBe("Due");
      expect((await app.inject({ method: "GET", url: link })).body).not.toMatch(/name="deadline/);
      await owner.post(`/assign/tasks/${task._id}/edit`, base);
      expect((await store.tasks.findOne({ _id: task._id }))!.deadline).toBeUndefined();
    });
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
    await owner.post(`/assign/lists/${list._id}/remove`, { taskId: (await copyFor(store, extra))._id.toHexString() });
    const assignment = (await store.assignments.findOne({ listId: list._id, active: true }))!;
    const stream = await openStream(`/l/${assignment.code}/events`);
    try {
      await owner.post(`/assign/lists/${list._id}/add`, { taskId: extra._id.toHexString() });
      expect(await stream.readUntil("New Task added", 3)).toContain("New Task added: Extra");
      await owner.post(`/assign/lists/${list._id}/remove`, { taskId: (await copyFor(store, extra))._id.toHexString() });
      expect(await stream.readUntil("Task removed", 3)).toContain("Task removed: Extra");
      expect((await owner.get("/assign/feed")).body).toContain("Added Extra to Notices");
    } finally { stream.close(); }
  });

  it("delivers an added Task only to its Owner and its own Assignee, after storing it", async () => {
    const owner = browser(); await owner.login("routing-a@example.com");
    const other = browser(); await other.login("routing-b@example.com");
    for (const title of ["Base A", "Base B", "Extra A"]) await owner.post("/assign/tasks", { title });
    await other.post("/assign/tasks", { title: "Other owner Task" });
    const store = await openAssignStore(db), find = async (title: string) => (await store.tasks.findOne({ title }))!;
    await owner.post("/assign/lists", { name: "Mine", taskIds: (await find("Base A"))._id.toHexString() });
    await owner.post("/assign/lists", { name: "Sibling", taskIds: (await find("Base B"))._id.toHexString() });
    await other.post("/assign/lists", { name: "Theirs" });
    const codes: Record<string, string> = {};
    for (const [name, person, who] of [["Mine", "Sam", owner], ["Sibling", "Tia", owner], ["Theirs", "Uma", other]] as const) {
      const list = (await store.lists.findOne({ name }))!;
      await who.post(`/assign/lists/${list._id}/assign`, { person });
      codes[name] = await activeCode(store, list._id);
    }
    const address = await app.listen({ host: "127.0.0.1", port: 0 });
    const controller = new AbortController();
    const open = async (path: string, cookie?: string) => {
      const reader = (await fetch(`${address}${path}`, { headers: cookie ? { cookie } : {}, signal: controller.signal })).body!.getReader();
      let text = "";
      const pump = (async () => { for (;;) { const chunk = await reader.read(); if (chunk.done) return; text += new TextDecoder().decode(chunk.value); } })().catch(() => {});
      return { text: () => text, pump };
    };
    try {
      const mine = await open(`/l/${codes.Mine}/events`), sibling = await open(`/l/${codes.Sibling}/events`), theirs = await open(`/l/${codes.Theirs}/events`), otherOwner = await open("/assign/events", other.cookie()), ownerStream = await open("/assign/events", owner.cookie());
      const list = (await store.lists.findOne({ name: "Mine" }))!;
      await owner.post(`/assign/lists/${list._id}/add`, { taskId: (await find("Extra A"))._id.toHexString() });
      for (let i = 0; i < 50 && !(mine.text().includes("New Task added") && ownerStream.text().includes("New Task added")); i++) await new Promise(r => setTimeout(r, 50));
      expect(mine.text()).toContain("New Task added: Extra A");
      expect(ownerStream.text()).toContain("New Task added: Extra A");
      const stored = (await store.events.findOne({ kind: "list.add", listId: list._id }))!;
      expect(mine.text()).toContain(`id: ${stored.seq}\n`);
      await new Promise(r => setTimeout(r, 200));
      for (const stream of [sibling, theirs, otherOwner]) expect(stream.text()).not.toContain("New Task added");
      expect(await store.events.countDocuments({ kind: "list.add" })).toBe(1);
      expect((await owner.get("/assign/feed")).body).toContain("Added Extra A to Mine");
      expect((await other.get("/assign/feed")).body).not.toContain("Extra A");
    } finally { controller.abort(); }
  });

  describe("status buttons and collapsed Tasks", () => {
    const statusButtons = (html: string) => [...html.matchAll(/<button[^>]*name="status"[^>]*>(.*?)<\/button>/g)].map(m => m[1]!).filter(label => label !== "Save Blocked");
    const outsideDetails = (html: string) => { let depth = 0, out = ""; for (const part of html.split(/(<\/?details[^>]*>)/)) { if (/^<details/.test(part)) depth++; else if (part === "</details>") depth--; else if (!depth) out += part; } return out; };
    const rowParts = (html: string) => { const m = html.match(/<details>\s*<summary>([\s\S]*?)<\/summary>([\s\S]*?)<\/details>/); return { summary: m![1]!, body: m![2]! }; };
    async function assigned() {
      const owner = browser(); await owner.login("buttons@example.com");
      await owner.post("/assign/tasks", { title: "Pack books", instruction: "Use small boxes", tags: "move", deadlineDate: "2099-01-02", deadlineTime: "10:00", timezoneOffset: "0" });
      const store = await openAssignStore(db), template = (await store.tasks.findOne({ title: "Pack books" }))!;
      await owner.post("/assign/lists", { name: "Move-out", taskIds: template._id.toHexString() });
      const list = (await store.lists.findOne({ name: "Move-out" }))!, task = await copyFor(store, template);
      await owner.post(`/assign/lists/${list._id}/assign`, { person: "Omar" });
      const assignment = (await store.assignments.findOne({ listId: list._id, active: true }))!;
      const link = `/l/${assignment.code}`;
      const assigneePost = (status: string, note = "") => postForm(`${link}/tasks/${task._id}/status`, { status, note });
      const assigneePage = async () => (await app.inject({ method: "GET", url: link })).body;
      const ownerPage = async () => (await owner.get("/assign/tasks")).body;
      // Only the Owner's row for the copy: the Template above it never has a status.
      const ownerCopyRow = async () => ((await ownerPage()).split('<li class="copy-item').find((part: string) => part.includes(`/assign/tasks/${task._id}`)) || "").split("</li>")[0]!;
      return { owner, store, task, list, assigneePost, assigneePage, ownerPage, ownerCopyRow };
    }
    it("offers exactly the valid status buttons to the Assignee and a single done toggle on the Owner's board row", async () => {
      const scene = await assigned();
      const toggle = async () => (await scene.ownerCopyRow()).match(/<button class="check" name="status" value="(\w+)"/)![1];
      expect([await toggle(), statusButtons(await scene.assigneePage())]).toEqual(["done", ["Blocked", "Done"]]);
      await scene.assigneePost("blocked");
      expect([await toggle(), statusButtons(await scene.assigneePage())]).toEqual(["done", ["Done", "Reopen"]]);
      await scene.assigneePost("done");
      expect([await toggle(), statusButtons(await scene.assigneePage())]).toEqual(["open", ["Reopen"]]);
    });
    it("lets Blocked be posted as a plain form submit", async () => {
      const scene = await assigned();
      expect(await scene.assigneePage()).toMatch(/<button[^>]*name="status"[^>]*value="blocked"[^>]*data-block|<button[^>]*data-block[^>]*name="status"[^>]*value="blocked"/);
    });
    it("reopens a Done Task in one click, from the collapsed row, and clears the completed List", async () => {
      const scene = await assigned();
      await scene.assigneePost("done");
      expect((await scene.store.lists.findOne({ _id: scene.list._id }))!.completedAt).toBeTruthy();
      const collapsed = outsideDetails(await scene.assigneePage());
      expect(collapsed).toContain("Reopen");
      expect((await scene.assigneePost("open")).statusCode).toBe(303);
      expect((await scene.store.tasks.findOne({ _id: scene.task._id }))!.status).toBe("open");
      expect((await scene.store.lists.findOne({ _id: scene.list._id }))!.completedAt).toBeUndefined();
      await scene.owner.post(`/assign/tasks/${scene.task._id}/status`, { status: "done" });
      expect((await scene.owner.post(`/assign/tasks/${scene.task._id}/status`, { status: "open" })).statusCode).toBe(303);
      expect((await scene.store.tasks.findOne({ _id: scene.task._id }))!.status).toBe("open");
    });
    it("collapses Tasks to title and buttons for the Assignee, and reveals details on expansion", async () => {
      const scene = await assigned();
      await scene.assigneePost("blocked", "Need paint");
      for (const status of ["blocked", "done"]) {
        if (status === "done") await scene.assigneePost("done", "");
        const { summary, body } = rowParts(await scene.assigneePage());
        expect(summary).toContain("Pack books");
        for (const hidden of ["badge", "Deadline", "Use small boxes", "move"]) expect(summary).not.toContain(hidden);
        for (const shown of ["Use small boxes", "move", "Deadline"]) expect(body).toContain(shown);
      }
      expect(rowParts(await scene.assigneePage()).body).toContain("Need paint");
    });
    it("shows a Template as one row with checkbox, title and list count, keeping its details off the board", async () => {
      const scene = await assigned();
      await scene.owner.post("/assign/tasks", { title: "Loose task", instruction: "Secret detail" });
      const html = await scene.ownerPage();
      const loose = html.slice(html.indexOf('<li class="tpl-row"', html.indexOf("Loose task") - 600));
      const row = loose.slice(0, loose.indexOf("</li>"));
      expect(row).toMatch(/<input type="checkbox" name="taskIds"[^>]*>[\s\S]*Select Loose task/);
      expect(row).toContain("Loose task"); expect(row).toContain("in 0 lists");
      expect(html).not.toContain("Secret detail");
    });
  });

  describe("Add Tasks to an existing List", () => {
    const setup = async (email: string, titles: string[]) => {
      const owner = browser(); await owner.login(email);
      for (const title of titles) await owner.post("/assign/tasks", { title });
      const store = await openAssignStore(db);
      const task = async (title: string) => (await store.tasks.findOne({ title }))!;
      const id = async (title: string) => (await task(title))._id.toHexString();
      return { owner, store, id, task };
    };
    const linkPage = async (store: Awaited<ReturnType<typeof openAssignStore>>, listId: ObjectId) => (await app.inject({ method: "GET", url: `/l/${await activeCode(store, listId)}` })).body;

    it("tags only Tasks added after first assignment, through Done, revoke and reassign to another Person", async () => {
      const { owner, store, id, task, tid } = await seedTasks("addtag@example.com", ["Early", "Late"]);
      await owner.post("/assign/lists", { name: "Tagged", taskIds: await tid("Early") });
      const list = (await store.lists.findOne({ name: "Tagged" }))!;
      await owner.post(`/assign/lists/${list._id}/add`, { taskId: await tid("Late") });
      const additional = (html: string) => (html.match(/Additional task/g) || []).length;
      expect(additional((await owner.get("/assign/tasks")).body)).toBe(0);
      await owner.post(`/assign/lists/${list._id}/assign`, { person: "Sam" });
      expect(additional(await linkPage(store, list._id))).toBe(0);
      await owner.post("/assign/tasks", { title: "After" });
      await owner.post(`/assign/lists/${list._id}/add`, { taskId: await tid("After") });
      expect(additional((await owner.get("/assign/tasks")).body)).toBe(1);
      expect(additional(await linkPage(store, list._id))).toBe(1);
      await owner.post(`/assign/tasks/${(await task("After"))._id}/status`, { status: "done" });
      expect(additional((await owner.get("/assign/tasks")).body)).toBe(1);
      expect(additional(await linkPage(store, list._id))).toBe(1);
      await owner.post(`/assign/lists/${list._id}/revoke`);
      await owner.post(`/assign/lists/${list._id}/assign`, { person: "Priya" });
      expect(additional(await linkPage(store, list._id))).toBe(1);
      expect(additional((await owner.get("/assign/tasks")).body)).toBe(1);
    });

    it("accepts a Template into any number of Lists but never a copy, from both entry points", async () => {
      const { owner, store, id, tid } = await seedTasks("onelist@example.com", ["Mine", "Taken", "Free"]);
      await owner.post("/assign/lists", { name: "One", taskIds: await tid("Mine") });
      await owner.post("/assign/lists", { name: "Two", taskIds: await tid("Taken") });
      const one = (await store.lists.findOne({ name: "One" }))!, two = (await store.lists.findOne({ name: "Two" }))!;
      const takenCopy = await id("Taken");
      expect(takenCopy).not.toBe(await tid("Taken"));
      expect((await owner.post(`/assign/lists/${one._id}/add`, { taskId: takenCopy })).statusCode).toBe(400);
      expect((await owner.post("/assign/lists/add-selected", { listId: one._id.toHexString(), taskIds: [takenCopy, await tid("Free")] })).statusCode).toBe(400);
      expect(await store.tasks.countDocuments({ listId: one._id })).toBe(1);
      const picker = (await owner.get("/assign/tasks")).body;
      expect(picker).toContain(`value="${await tid("Free")}"`); expect(picker).toContain(`value="${await tid("Taken")}"`); expect(picker).not.toContain(`name="taskIds" value="${takenCopy}"`);
      expect((await owner.post(`/assign/lists/${one._id}/add`, { taskId: await tid("Taken") })).statusCode).toBe(303);
      expect((await owner.post("/assign/lists/add-selected", { listId: two._id.toHexString(), taskIds: await tid("Free") })).statusCode).toBe(303);
      expect((await store.tasks.findOne({ title: "Free", kind: "copy" }))!.listId).toEqual(two._id);
      expect(await store.tasks.countDocuments({ title: "Taken", kind: "copy" })).toBe(2);
    });

    it("offers Add to List on the Tasks page with the Owner's existing Lists", async () => {
      const { owner } = await seedTasks("offer@example.com", ["Solo"]);
      await owner.post("/assign/lists", { name: "Existing" });
      const html = (await owner.get("/assign/tasks")).body;
      expect(html).toContain("Add to existing"); expect(html).toMatch(/<select id="add-target" name="listId">[^]*Existing/);
    });

    it("makes a completed List not completed again when a Task is added", async () => {
      const { owner, store, id, task, tid } = await seedTasks("reopen@example.com", ["Only", "More"]);
      await owner.post("/assign/lists", { name: "Finished", taskIds: await tid("Only"), person: "Sam" });
      const list = (await store.lists.findOne({ name: "Finished" }))!;
      await owner.post(`/assign/tasks/${(await task("Only"))._id}/status`, { status: "done" });
      expect((await store.lists.findOne({ _id: list._id }))!.completedAt).toBeTruthy();
      await owner.post("/assign/lists/add-selected", { listId: list._id.toHexString(), taskIds: await tid("More") });
      expect((await store.lists.findOne({ _id: list._id }))!.completedAt).toBeUndefined();
      await owner.post(`/assign/tasks/${(await task("More"))._id}/status`, { status: "done" });
      expect((await store.lists.findOne({ _id: list._id }))!.completedAt).toBeTruthy();
    });
  });

  describe("Removed Task rows", () => {
    const page = async (code: string) => (await app.inject({ method: "GET", url: `/l/${code}` })).body;
    const removedSection = (html: string) => html.match(/<h2>Removed<\/h2>[^]*?<\/section>/)?.[0] || "";

    it("shows a deleted Task by its title as Removed, with no buttons or Note", async () => {
      const { owner, store, id, tid } = await seedTasks("rm-delete@example.com", ["Keep", "Doomed"]);
      await owner.post("/assign/lists", { name: "Gone", taskIds: [await tid("Keep"), await tid("Doomed")], person: "Sam" });
      const list = (await store.lists.findOne({ name: "Gone" }))!, code = await activeCode(store, list._id);
      await owner.post(`/assign/tasks/${await id("Doomed")}/delete`);
      const section = removedSection(await page(code));
      expect(section).toContain("Doomed"); expect(section).toContain("Removed"); expect(section).toMatch(/<time/);
      expect(section).not.toMatch(/<button|<form|<textarea|<input/);
    });

    it("shows both Done and not-Done removals but nothing for a Draft List", async () => {
      const { owner, store, id, tid } = await seedTasks("rm-done@example.com", ["Stay", "Finished", "Open", "DraftOne"]);
      await owner.post("/assign/lists", { name: "Live", taskIds: [await tid("Stay"), await tid("Finished"), await tid("Open")], person: "Sam" });
      const live = (await store.lists.findOne({ name: "Live" }))!, code = await activeCode(store, live._id);
      await owner.post(`/assign/tasks/${await id("Finished")}/status`, { status: "done" });
      await owner.post(`/assign/lists/${live._id}/remove`, { taskId: await id("Finished") });
      await owner.post(`/assign/lists/${live._id}/remove`, { taskId: await id("Open") });
      const section = removedSection(await page(code));
      expect(section).toContain("Finished"); expect(section).toContain("Open");
      await owner.post("/assign/lists", { name: "Sketch", taskIds: await tid("DraftOne") });
      const draft = (await store.lists.findOne({ name: "Sketch" }))!;
      await owner.post(`/assign/lists/${draft._id}/remove`, { taskId: await id("DraftOne") });
      await owner.post("/assign/tasks", { title: "DraftTwo" });
      await owner.post(`/assign/lists/${draft._id}/add`, { taskId: await tid("DraftTwo") });
      await owner.post(`/assign/tasks/${await id("DraftTwo")}/delete`);
      await owner.post(`/assign/lists/${draft._id}/assign`, { person: "Tia" });
      const draftCode = await activeCode(store, draft._id);
      expect(await page(draftCode)).not.toContain("Removed");
    });

    it("keeps the Removed row when the Template is added again as a new Additional Task", async () => {
      const { owner, store, id, tid } = await seedTasks("rm-readd@example.com", ["Base", "Back"]);
      await owner.post("/assign/lists", { name: "Readd", taskIds: [await tid("Base"), await tid("Back")], person: "Sam" });
      const list = (await store.lists.findOne({ name: "Readd" }))!, code = await activeCode(store, list._id);
      await owner.post(`/assign/lists/${list._id}/remove`, { taskId: await id("Back") });
      expect(removedSection(await page(code))).toContain("Back");
      await owner.post(`/assign/lists/${list._id}/add`, { taskId: await tid("Back") });
      const html = await page(code);
      expect(removedSection(html)).toContain("Back");
      expect(html).toMatch(/Back[^]*?Additional task/);
    });

    it("excludes Removed rows from progress and completes an all-Done remainder", async () => {
      const { owner, store, id, tid } = await seedTasks("rm-progress@example.com", ["One", "Two", "Three"]);
      await owner.post("/assign/lists", { name: "Prog", taskIds: [await tid("One"), await tid("Two"), await tid("Three")], person: "Sam" });
      const list = (await store.lists.findOne({ name: "Prog" }))!, code = await activeCode(store, list._id);
      await owner.post(`/assign/tasks/${await id("One")}/status`, { status: "done" });
      await owner.post(`/assign/lists/${list._id}/remove`, { taskId: await id("Three") });
      await owner.post(`/assign/tasks/${await id("Two")}/delete`);
      expect(await page(code)).toContain("1 of 1 done");
      expect((await owner.get("/assign")).body).toContain("1 of 1 done");
      expect((await owner.get("/assign/tasks")).body).toContain("1 of 1 done");
      expect((await store.lists.findOne({ _id: list._id }))!.completedAt).toBeTruthy();
      expect(removedSection(await page(code))).toMatch(/Two[^]*Three|Three[^]*Two/);
    });

    it("tells the open page and the Board feed when a Task is removed or deleted", async () => {
      const { owner, store, id, tid } = await seedTasks("rm-live@example.com", ["Base", "Out", "Zap"]);
      await owner.post("/assign/lists", { name: "Feed", taskIds: [await tid("Base"), await tid("Out"), await tid("Zap")], person: "Sam" });
      const list = (await store.lists.findOne({ name: "Feed" }))!, code = await activeCode(store, list._id);
      const stream = await openStream(`/l/${code}/events`);
      try {
        await owner.post(`/assign/lists/${list._id}/remove`, { taskId: await id("Out") });
        expect(await stream.readUntil("Task removed: Out")).toContain("Task removed: Out");
        await owner.post(`/assign/tasks/${await id("Zap")}/delete`);
        expect(await stream.readUntil("Task removed: Zap")).toContain("Task removed: Zap");
        const feed = (await owner.get("/assign/feed")).body;
        expect(feed).toContain("Removed Out from Feed"); expect(feed).toContain("Removed Zap from Feed");
      } finally { stream.close(); }
    });
  });

  describe("Retention: soft delete for analytics", () => {
    it("keeps a deleted Task with its reason and hides it everywhere", async () => {
      const { owner, store, id, task, tid } = await seedTasks("soft-task@example.com", ["Keeper", "Doomed"]);
      await owner.post("/assign/lists", { name: "Chores", taskIds: [await tid("Keeper"), await tid("Doomed")], person: "Sam" });
      const doomed = await task("Doomed");
      await owner.post(`/assign/tasks/${doomed._id}/status`, { status: "blocked", note: "stuck" });
      await owner.post(`/assign/tasks/${doomed._id}/delete`);
      const row = (await store.tasks.findOne({ _id: doomed._id }))!;
      expect(row.deletedAt).toBeInstanceOf(Date); expect(row.deleteReason).toBe("removed");
      expect(row.status).toBe("blocked"); expect(row.note).toBe("stuck");
      const list = (await store.lists.findOne({ name: "Chores" }))!, code = await activeCode(store, list._id);
      expect((await owner.get("/assign/tasks")).body).not.toContain(`/assign/tasks/${doomed._id}`);
      expect((await owner.get("/assign/tasks")).body).toContain('Templates <span class="muted">(2)</span>'); // the removed copy is not a Template
      expect((await owner.get("/assign/tasks")).body).toContain('<span class="count">1 task</span>'); // and no longer counts in its List
      expect((await owner.get(`/assign/tasks/${doomed._id}`)).statusCode).toBe(404);
      expect((await owner.post(`/assign/tasks/${doomed._id}/status`, { status: "done" })).statusCode).toBe(404);
      expect((await owner.get("/assign/tasks")).body).toContain("(0 of 1 done)");
      expect((await owner.get("/assign")).body).toContain("0 of 1 done");
      const link = (await app.inject({ method: "GET", url: `/l/${code}` })).body;
      expect(link).toContain("0 of 1 done");
      expect((await postForm(`/l/${code}/tasks/${doomed._id}/status`, "status=done")).statusCode).toBe(404);
      expect((await store.tasks.findOne({ _id: doomed._id }))!.status).toBe("blocked");
      expect((await owner.post(`/assign/lists/${list._id}/add`, { taskId: doomed._id.toHexString() })).statusCode).toBe(400);
    });

    it("keeps a deleted List, hides it, and ends its link and stream", async () => {
      const { owner, store, id, tid } = await seedTasks("soft-list@example.com", ["Item"]);
      await owner.post("/assign/lists", { name: "Doomed List", taskIds: [await tid("Item")], person: "Sam" });
      const list = (await store.lists.findOne({ name: "Doomed List" }))!, code = await activeCode(store, list._id);
      await owner.post(`/assign/lists/${list._id}/delete`);
      const row = (await store.lists.findOne({ _id: list._id }))!;
      expect(row.deletedAt).toBeInstanceOf(Date); expect(row.deleteReason).toBe("list-deleted"); expect(row.name).toBe("Doomed List");
      expect((await owner.get("/assign/lists")).body).not.toContain("Doomed List");
      expect((await owner.get("/assign/tasks")).body).not.toContain("Doomed List");
      expect((await owner.get("/assign")).body).not.toContain("Doomed List");
      expect((await owner.get(`/assign/lists/${list._id}`)).statusCode).toBe(404);
      expect((await owner.post(`/assign/lists/${list._id}/edit`, { name: "x" })).statusCode).toBe(404);
      expect((await owner.post("/assign/lists/add-selected", { listId: list._id.toHexString(), taskIds: await tid("Item") })).statusCode).toBe(404);
      expect((await app.inject({ method: "GET", url: `/l/${code}/events` })).statusCode).toBe(404);
    });

    it("keeps a deleted Person with their name, hides them, and lets the name be reused", async () => {
      const { owner, store, id, tid } = await seedTasks("soft-person@example.com", ["Job"]);
      await owner.post("/assign/lists", { name: "Mine", taskIds: [await tid("Job")], person: "Zed" });
      const old = (await store.people.findOne({ name: "Zed" }))!;
      await owner.post(`/assign/people/${old._id}/delete`);
      const row = (await store.people.findOne({ _id: old._id }))!;
      expect(row.deletedAt).toBeInstanceOf(Date); expect(row.deleteReason).toBe("person-deleted"); expect(row.name).toBe("Zed");
      expect((await owner.get("/assign/people")).body).not.toContain("Zed");
      expect((await owner.get("/assign")).body).not.toContain("Zed");
      expect((await owner.get(`/assign/people/${old._id}/delete`)).statusCode).toBe(404);
      const list = (await store.lists.findOne({ name: "Mine" }))!;
      expect((await owner.get("/assign/tasks")).body).not.toContain("<option value=\"Zed\">");
      expect((await owner.post(`/assign/lists/${list._id}/assign`, { person: "zed" })).statusCode).toBe(303);
      const again = (await store.assignments.findOne({ listId: list._id, active: true }))!;
      expect(again.personId!.equals(old._id)).toBe(false);
      expect((await owner.get("/assign/people")).body).toContain("<strong>zed</strong>");
      expect((await store.people.findOne({ _id: old._id }))!.name).toBe("Zed");
    });

    it("records doneAt when a Task is marked Done and keeps Done Tasks through housekeeping", async () => {
      const { owner, store, id, task, tid } = await seedTasks("soft-done@example.com", ["Finish"]);
      await owner.post("/assign/lists", { name: "Fin", taskIds: [await tid("Finish")], person: "Sam" });
      const t = await task("Finish"), code = await activeCode(store, t.listId!);
      expect(t.doneAt).toBeUndefined();
      await postForm(`/l/${code}/tasks/${t._id}/status`, "status=done");
      const done = (await store.tasks.findOne({ _id: t._id }))!;
      expect(done.doneAt).toBeInstanceOf(Date);
      const later = new Date(Date.now() + 400 * 86_400_000);
      await purgeOld({ store, config: loadAssignConfig({ PUBLIC_URL: "http://assign.test", ASSIGN_JWT_SECRET: "x".repeat(32) })!, mailer: { send: async () => {} }, now: () => later, limiter: createRateLimiter(() => later) });
      expect(await store.tasks.countDocuments({ _id: t._id, status: "done", doneAt: { $exists: true } })).toBe(1);
      await postForm(`/l/${code}/tasks/${t._id}/status`, "status=open");
      expect((await store.tasks.findOne({ _id: t._id }))!.doneAt).toBeUndefined();
    });
  });

  describe("Add to List copies a Template", () => {
    const copiesOf = (store: Store, title: string) => store.tasks.find({ title, kind: "copy" }).sort({ createdAt: 1, _id: 1 }).toArray();
    const template = async (store: Store, title: string) => (await store.tasks.findOne({ title, kind: "template" }))!;

    it("gives each List an independent copy and leaves the Template in the main list", async () => {
      const { owner, store } = await seedTasks("copy-two@example.com", []);
      await owner.post("/assign/tasks", { title: "Water plants", instruction: "Twice", tags: "home", deadlineDate: "2099-01-02", deadlineTime: "10:00", timezoneOffset: "0" });
      const source = (await store.tasks.findOne({ title: "Water plants" }))!;
      await owner.post("/assign/lists", { name: "A" }); await owner.post("/assign/lists", { name: "B" });
      const a = (await store.lists.findOne({ name: "A" }))!, b = (await store.lists.findOne({ name: "B" }))!;
      expect((await owner.post(`/assign/lists/${a._id}/add`, { taskId: source._id.toHexString() })).statusCode).toBe(303);
      expect((await owner.post("/assign/lists/add-selected", { listId: b._id.toHexString(), taskIds: source._id.toHexString() })).statusCode).toBe(303);
      const copies = await copiesOf(store, "Water plants");
      expect(copies).toHaveLength(2);
      expect(copies.map(c => String(c.listId)).sort()).toEqual([String(a._id), String(b._id)].sort());
      for (const c of copies) { expect(c.instruction).toBe("Twice"); expect(c.tags).toEqual(["home"]); expect(c.deadline).toEqual(source.deadline); expect(c.status).toBe("open"); expect(c.note).toBe(""); expect(c._id.equals(source._id)).toBe(false); }
      const fresh = (await store.tasks.findOne({ _id: source._id }))!;
      expect(fresh.kind).toBe("template"); expect(fresh.listId).toBeUndefined(); expect(fresh.deletedAt).toBeUndefined();
      await owner.post(`/assign/tasks/${copies[0]!._id}/status`, { status: "blocked", note: "no water" });
      const [first, second] = await copiesOf(store, "Water plants");
      expect(first!.status).toBe("blocked"); expect(first!.note).toBe("no water");
      expect(second!.status).toBe("open"); expect(second!.note).toBe("");
      expect((await store.tasks.findOne({ _id: source._id }))!.status).toBe("open");
    });

    it("adds a Template to a new List at creation and again to others", async () => {
      const { owner, store, id, tid } = await seedTasks("copy-create@example.com", ["Shared"]);
      await owner.post("/assign/lists", { name: "One", taskIds: await tid("Shared") });
      await owner.post("/assign/lists", { name: "Two", taskIds: await tid("Shared") });
      expect(await copiesOf(store, "Shared")).toHaveLength(2);
      expect((await store.lists.findOne({ name: "One" }))!.taskCount).toBe(1);
      expect((await template(store, "Shared")).listId).toBeUndefined();
    });

    it("removes only the copy, keeps it hidden but retained, and leaves the Template in place", async () => {
      const { owner, store, id, tid } = await seedTasks("copy-remove@example.com", ["Sweep"]);
      await owner.post("/assign/lists", { name: "Chores", taskIds: await tid("Sweep"), person: "Sam" });
      const list = (await store.lists.findOne({ name: "Chores" }))!, code = await activeCode(store, list._id);
      const [copy] = await copiesOf(store, "Sweep");
      await owner.post(`/assign/lists/${list._id}/remove`, { taskId: copy!._id.toHexString() });
      const row = (await store.tasks.findOne({ _id: copy!._id }))!;
      expect(row.deletedAt).toBeInstanceOf(Date); expect(row.deleteReason).toBe("removed");
      const tmpl = await template(store, "Sweep");
      expect(tmpl.deletedAt).toBeUndefined();
      expect((await owner.get("/assign/tasks")).body).toContain(`/assign/tasks/${tmpl._id}`);
      expect((await owner.get("/assign/tasks")).body).not.toContain(`/assign/tasks/${copy!._id}`);
      expect((await app.inject({ method: "GET", url: `/l/${code}` })).body).toMatch(/<h2>Removed<\/h2>[^]*Sweep/);
      expect((await owner.get("/assign/tasks")).body).toContain("(0 of 0 done)");
      expect((await owner.post(`/assign/lists/${list._id}/add`, { taskId: tmpl._id.toHexString() })).statusCode).toBe(303);
      expect(await copiesOf(store, "Sweep")).toHaveLength(2);
    });

    it("leaves copies unchanged when the Template is edited or deleted, retaining the Template row", async () => {
      const { owner, store, id, tid } = await seedTasks("copy-edit@example.com", ["Original"]);
      await owner.post("/assign/lists", { name: "Holder", taskIds: await tid("Original"), person: "Sam" });
      const list = (await store.lists.findOne({ name: "Holder" }))!, code = await activeCode(store, list._id);
      const tmpl = await template(store, "Original");
      await owner.post(`/assign/tasks/${tmpl._id}/edit`, { title: "Renamed", instruction: "New", tags: "x" });
      const [copy] = await copiesOf(store, "Original");
      expect(copy!.instruction).toBe(""); expect(copy!.tags).toEqual([]);
      expect(await store.tasks.countDocuments({ title: "Renamed", kind: "template" })).toBe(1);
      await owner.post(`/assign/tasks/${tmpl._id}/delete`);
      const gone = (await store.tasks.findOne({ _id: tmpl._id }))!;
      expect(gone.deletedAt).toBeInstanceOf(Date); expect(gone.deleteReason).toBe("template-deleted");
      const kept = (await store.tasks.findOne({ _id: copy!._id }))!;
      expect(kept.deletedAt).toBeUndefined();
      const page = (await app.inject({ method: "GET", url: `/l/${code}` })).body;
      expect(page).toContain("Original"); expect(page).not.toContain("<h2>Removed</h2>");
      expect((await owner.get("/assign/tasks")).body).toContain("(0 of 1 done)");
    });

    it("sends the Additional Task only to that List's Owner and Assignee streams when a Template is added", async () => {
      const { owner, store, id, tid } = await seedTasks("copy-live@example.com", ["Base", "Extra"]);
      await owner.post("/assign/lists", { name: "Mine", taskIds: await tid("Base"), person: "Sam" });
      await owner.post("/assign/lists", { name: "Other", taskIds: await tid("Base"), person: "Tia" });
      const mine = (await store.lists.findOne({ name: "Mine" }))!, other = (await store.lists.findOne({ name: "Other" }))!;
      const mineStream = await openStream(`/l/${await activeCode(store, mine._id)}/events`);
      const otherStream = await openStream(`/l/${await activeCode(store, other._id)}/events`);
      try {
        await owner.post(`/assign/lists/${mine._id}/add`, { taskId: await tid("Extra") });
        expect(await mineStream.readUntil("New Task added: Extra")).toContain("New Task added: Extra");
        const html = (await app.inject({ method: "GET", url: `/l/${await activeCode(store, mine._id)}` })).body;
        expect(html).toMatch(/Extra[^]*?Additional task/);
        await new Promise(r => setTimeout(r, 200));
        expect(await store.events.countDocuments({ kind: "list.add" })).toBe(1);
        expect((await store.events.findOne({ kind: "list.add" }))!.listId).toEqual(mine._id);
      } finally { mineStream.close(); otherStream.close(); }
    });
  });

  describe("Single-page board", () => {
    const section = (html: string, cls: string) => html.match(new RegExp(`<(section|aside)[^>]*class="${cls}"[\\s\\S]*?</\\1>`))?.[0] || "";
    it("quick-add creates a Template that shows straight away in the Templates column, with a checkbox and an in-N-lists label", async () => {
      const { owner } = await seedTasks("board-quick@example.com", []);
      const added = await owner.post("/assign/tasks", { title: "Quick one" });
      expect(added.statusCode).toBe(303); expect(added.headers.location).toBe("/assign/tasks");
      const html = (await owner.get("/assign/tasks")).body;
      expect(html).toMatch(/<form[^>]*action="\/assign\/tasks"[^>]*>[\s\S]*?<input[^>]*name="title"/);
      const templates = section(html, "templates-panel");
      expect(templates).toContain("Quick one");
      expect(templates).toMatch(/<input type="checkbox" name="taskIds" value="[0-9a-f]{24}" form="select-tasks">/);
      expect(templates).toContain("in 0 lists");
    });
    it("lists only Templates on the left and counts the Lists each one is in", async () => {
      const { owner, tid } = await seedTasks("board-left@example.com", ["Shared", "Solo"]);
      await owner.post("/assign/lists", { name: "One", taskIds: await tid("Shared") });
      await owner.post("/assign/lists", { name: "Two", taskIds: await tid("Shared") });
      const html = (await owner.get("/assign/tasks")).body;
      const templates = section(html, "templates-panel");
      expect(templates.match(/name="taskIds"/g)).toHaveLength(2);
      expect(templates).toMatch(/Shared[\s\S]*?in 2 lists/);
      expect(templates).toMatch(/Solo[\s\S]*?in 0 lists/);
      expect(html).toMatch(/Tick tasks/);
      expect(html).not.toMatch(/<a href="\/assign\/lists"/);
    });
    it("shows each List with pill, progress, count and expandable copies with done and remove controls", async () => {
      const { owner, store, tid } = await seedTasks("board-right@example.com", ["A", "B"]);
      await owner.post("/assign/lists", { name: "Plan", taskIds: [await tid("A"), await tid("B")] });
      const list = (await store.lists.findOne({ name: "Plan" }))!;
      let panel = section((await owner.get("/assign/tasks")).body, "lists-panel");
      expect(panel).toContain("Not shared"); expect(panel).toContain("2 tasks");
      expect(panel).toMatch(/<progress[^>]*value="0"[^>]*max="2"/);
      expect(panel).toMatch(/<details[^>]*id="list-[0-9a-f]{24}"/);
      const copyA = (await store.tasks.findOne({ title: "A", kind: "copy" }))!;
      expect(panel).toContain(`action="/assign/tasks/${copyA._id}/status"`);
      expect(panel).toMatch(new RegExp(`action="/assign/lists/${list._id}/remove"[\\s\\S]*?name="taskId" value="${copyA._id}"[\\s\\S]*?✕`));
      await owner.post(`/assign/lists/${list._id}/link`);
      expect(section((await owner.get("/assign/tasks")).body, "lists-panel")).toContain("Awaiting name");
      await owner.post(`/assign/lists/${list._id}/assign`, { person: "Omar" });
      await owner.post(`/assign/tasks/${copyA._id}/status`, { status: "done" });
      panel = section((await owner.get("/assign/tasks")).body, "lists-panel");
      expect(panel).toContain("Omar"); expect(panel).not.toContain("Awaiting name");
      expect(panel).toMatch(/<progress[^>]*value="1"[^>]*max="2"/);
    });
    it("opens the requested List and returns to the board after list and status requests", async () => {
      const { owner, store, tid } = await seedTasks("board-back@example.com", ["A"]);
      await owner.post("/assign/lists", { name: "Plan" });
      const list = (await store.lists.findOne({ name: "Plan" }))!, target = `/assign/tasks?list=${list._id}#list-${list._id}`;
      const added = await owner.post(`/assign/lists/${list._id}/add`, { taskId: await tid("A") });
      expect(added.headers.location).toBe(target);
      expect((await owner.get(target.split("#")[0]!)).body).toMatch(new RegExp(`<details[^>]*id="list-${list._id}"[^>]* open`));
      const copy = (await store.tasks.findOne({ kind: "copy" }))!;
      expect((await owner.post(`/assign/tasks/${copy._id}/status`, { status: "done", board: "1" })).headers.location).toBe(target);
      expect((await owner.post(`/assign/lists/${list._id}/remove`, { taskId: copy._id.toHexString() })).headers.location).toBe(target);
      expect((await owner.post("/assign/lists", { name: "Fresh" })).headers.location).toMatch(/^\/assign\/tasks\?list=[0-9a-f]{24}#list-/);
    });
    it("sends the old Lists and List-page URLs to the new page and drops the Lists nav item", async () => {
      const { owner, store } = await seedTasks("board-old@example.com", []);
      await owner.post("/assign/lists", { name: "Plan" });
      const list = (await store.lists.findOne({ name: "Plan" }))!;
      const index = await owner.get("/assign/lists");
      expect(index.statusCode).toBe(303); expect(index.headers.location).toBe("/assign/tasks");
      const old = await owner.get(`/assign/lists/${list._id}`);
      expect(old.statusCode).toBe(303); expect(old.headers.location).toBe(`/assign/tasks?list=${list._id}#list-${list._id}`);
      expect((await owner.get(`/assign/lists/${"0".repeat(24)}`)).statusCode).toBe(404);
      const nav = (await owner.get("/assign/tasks")).body.match(/<nav aria-label="Task assignment">[\s\S]*?<\/nav>/)![0];
      expect(nav).not.toContain("/assign/lists");
    });
  });

  it("creates a List with copies and its unassigned link in one request, auto-naming blank names", async () => {
    const { owner, store, tid } = await seedTasks("bar@example.com", ["Mop", "Dust"]);
    const both = [await tid("Mop"), await tid("Dust")];
    const made = await owner.post("/assign/lists", { name: "", taskIds: both, link: "1" });
    expect(made.statusCode).toBe(200);
    const body = made.json() as { url: string; listId: string };
    expect(body.url).toMatch(/^http:\/\/assign\.test\/l\/[A-Za-z0-9]{10}$/);
    const first = (await store.lists.findOne({ _id: new ObjectId(body.listId) }))!;
    expect(first.name).toBe("List 1"); expect(first.taskCount).toBe(2);
    expect(await store.tasks.countDocuments({ listId: first._id, kind: "copy" })).toBe(2);
    const link = (await store.assignments.findOne({ listId: first._id, active: true }))!;
    expect(link.personId).toBeUndefined(); expect(body.url.endsWith(link.code)).toBe(true);
    const typed = (await owner.post("/assign/lists", { name: "Kitchen", taskIds: both[0]!, link: "1" })).json() as { listId: string };
    expect((await store.lists.findOne({ _id: new ObjectId(typed.listId) }))!.name).toBe("Kitchen");
    const next = (await owner.post("/assign/lists", { name: "  ", taskIds: both[1]!, link: "1" })).json() as { listId: string };
    expect((await store.lists.findOne({ _id: new ObjectId(next.listId) }))!.name).toBe("List 3");
    expect((await owner.post("/assign/lists", { name: "", taskIds: [], link: "1" })).statusCode).toBe(400);
  });
  it("adds ticked Templates to an existing List that already has a live link as Additional Tasks", async () => {
    const { owner, store, tid } = await seedTasks("bar2@example.com", ["Mop", "Dust"]);
    const made = (await owner.post("/assign/lists", { name: "", taskIds: await tid("Mop"), link: "1" })).json() as { listId: string };
    expect((await owner.post("/assign/lists/add-selected", { listId: made.listId, taskIds: await tid("Dust") })).statusCode).toBe(303);
    const added = (await store.tasks.findOne({ listId: new ObjectId(made.listId), title: "Dust", kind: "copy" }))!;
    expect(added.addedToListAt).toBeDefined();
  });
  it("shows the select-and-share bar with Create list & copy link, Add to existing and Clear", async () => {
    const { owner } = await seedTasks("bar3@example.com", ["Mop"]);
    const page = (await owner.get("/assign/tasks")).body;
    expect(page).toContain("Create list &amp; copy link"); expect(page).toContain("Add to existing"); expect(page).toContain("Clear");
    expect(page).toContain("Create list &amp; copy link button");
    expect(page).not.toContain("tap Add to List");
  });
});
