import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { ObjectId } from "mongodb";
import type { TaskDue } from "../src/db.ts";
import { sendDueReminders, type ReminderEvent } from "../src/core/reminders.ts";
import { buildServer } from "../src/server.ts";
import { hashPassword } from "../src/users.ts";
import { useMemoryMongo } from "./fakes/memory-mongo.ts";

function basicAuth(username: string, password: string) {
  return { authorization: `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}` };
}

describe("dashboard Tasks page", () => {
  const database = useMemoryMongo();
  let server: FastifyInstance;
  let markdownDir: string;

  beforeAll(async () => {
    markdownDir = await mkdtemp(join(tmpdir(), "dashboard-tasks-markdown-"));
    server = buildServer({
      logger: false,
      inventory: { items: [], apiKey: "unused" },
      dashboard: { database: database(), defaultTimezone: "UTC", markdownDir },
    });
    await server.ready();
  });
  afterAll(async () => {
    await server.close();
    await rm(markdownDir, { recursive: true, force: true });
  });

  async function createUser(username: string, password: string, timezone?: string): Promise<ObjectId> {
    const { insertedId } = await database().users.insertOne({
      username,
      password: hashPassword(password),
      isAdmin: false,
      ...(timezone ? { timezone } : {}),
      channelIdentities: [{ channel: "telegram", channelId: `${username}-chat` }],
      createdAt: new Date(),
    });
    return insertedId;
  }

  let clock = Date.parse("2026-10-01T09:00:00Z");
  async function createTask(
    ownerId: ObjectId,
    task: { heading: string; description?: string; transcript?: string; due?: TaskDue; status?: "open" | "done" },
  ) {
    const at = new Date((clock += 60_000));
    const { insertedId } = await database().tasks.insertOne({
      ownerId,
      heading: task.heading,
      description: task.description ?? `Details of ${task.heading}`,
      due: task.due ?? null,
      status: task.status ?? "open",
      reminderSentAt: null,
      channelIdentity: { channel: "telegram", channelId: "42" },
      transcript: task.transcript ?? `transcript of ${task.heading}`,
      source: { channel: "telegram", chatId: "42", messageId: String(clock) },
      createdAt: at,
      updatedAt: at,
    });
    return insertedId;
  }

  function get(url: string, as: [string, string] = ["alice", "alice-pass"]) {
    return server.inject({ method: "GET", url, headers: basicAuth(...as) });
  }

  function post(url: string, form: Record<string, string> = {}, as: [string, string] = ["alice", "alice-pass"]) {
    return server.inject({
      method: "POST",
      url,
      headers: { ...basicAuth(...as), "content-type": "application/x-www-form-urlencoded" },
      payload: new URLSearchParams(form).toString(),
    });
  }

  describe("tabs", () => {
    it("lists only the User's own open Tasks on the Open tab, with Description, due date and Transcript", async () => {
      const alice = await createUser("alice", "alice-pass");
      const bob = await createUser("bob", "bob-pass");
      await createTask(alice, {
        heading: "Call the plumber",
        description: "The kitchen tap drips",
        transcript: "um I need to call the plumber about the tap",
        due: { kind: "date", date: "2026-11-03" },
      });
      await createTask(alice, { heading: "Renew passport", status: "done" });
      await createTask(bob, { heading: "Bob's secret errand" });

      const response = await get("/tasks");

      expect(response.statusCode).toBe(200);
      expect(response.body).toContain("Call the plumber");
      expect(response.body).toContain("The kitchen tap drips");
      expect(response.body).toContain("um I need to call the plumber about the tap");
      expect(response.body).toContain("Tue 3 Nov 2026");
      expect(response.body).not.toContain("Renew passport");
      expect(response.body).not.toContain("Bob");
    });

    it("lists only the User's own done Tasks on the Done tab", async () => {
      const alice = await createUser("alice", "alice-pass");
      const bob = await createUser("bob", "bob-pass");
      await createTask(alice, { heading: "Call the plumber" });
      await createTask(alice, { heading: "Renew passport", status: "done" });
      await createTask(bob, { heading: "Bob's finished errand", status: "done" });

      const page = (await get("/tasks?tab=done")).body;

      expect(page).toContain("Renew passport");
      expect(page).not.toContain("Call the plumber");
      expect(page).not.toContain("Bob");
    });

    it("shows a due time on the User's own clock", async () => {
      const alice = await createUser("alice", "alice-pass", "Asia/Dubai");
      await createTask(alice, { heading: "Dentist", due: { kind: "moment", at: new Date("2026-11-03T10:30:00Z") } });

      expect((await get("/tasks")).body).toContain("Tue 3 Nov 2026, 14:30");
    });

    it("says so when a tab is empty", async () => {
      await createUser("alice", "alice-pass");

      expect((await get("/tasks")).body).toContain("No open Tasks");
      expect((await get("/tasks?tab=done")).body).toContain("No done Tasks");
    });
  });

  describe("done and reopen", () => {
    it("marking a Task done moves it to the Done tab, and reopening moves it back", async () => {
      const alice = await createUser("alice", "alice-pass");
      const id = await createTask(alice, { heading: "Call the plumber" });

      const done = await post(`/tasks/${id}/done`);

      expect(done.statusCode).toBe(303);
      expect(done.headers.location).toBe("/tasks");
      expect((await get("/tasks")).body).not.toContain("Call the plumber");
      expect((await get("/tasks?tab=done")).body).toContain("Call the plumber");

      const reopened = await post(`/tasks/${id}/reopen`);

      expect(reopened.statusCode).toBe(303);
      expect(reopened.headers.location).toBe("/tasks?tab=done");
      expect((await get("/tasks")).body).toContain("Call the plumber");
      expect((await get("/tasks?tab=done")).body).not.toContain("Call the plumber");
    });

    it("cannot mark another User's Task done, nor reopen it", async () => {
      await createUser("alice", "alice-pass");
      const bob = await createUser("bob", "bob-pass");
      const bobsOpen = await createTask(bob, { heading: "Bob's open errand" });
      const bobsDone = await createTask(bob, { heading: "Bob's done errand", status: "done" });

      expect((await post(`/tasks/${bobsOpen}/done`)).statusCode).toBe(404);
      expect((await post(`/tasks/${bobsDone}/reopen`)).statusCode).toBe(404);
      expect((await post("/tasks/not-an-id/done")).statusCode).toBe(404);

      expect((await get("/tasks", ["bob", "bob-pass"])).body).toContain("Bob&#39;s open errand");
      expect((await get("/tasks?tab=done", ["bob", "bob-pass"])).body).toContain("Bob&#39;s done errand");
    });
  });

  describe("open", () => {
    it("shows a Task's edit form filled in with its Heading, Description and due date on the User's clock", async () => {
      const alice = await createUser("alice", "alice-pass", "Asia/Dubai");
      const id = await createTask(alice, {
        heading: "Dentist",
        description: "Check-up at the clinic",
        transcript: "dentist on tuesday half two",
        due: { kind: "moment", at: new Date("2026-11-03T10:30:00Z") },
      });

      const response = await get(`/tasks/${id}`);

      expect(response.statusCode).toBe(200);
      expect(response.body).toContain('value="Dentist"');
      expect(response.body).toContain("Check-up at the clinic");
      expect(response.body).toContain("dentist on tuesday half two");
      expect(response.body).toContain('value="2026-11-03"');
      expect(response.body).toContain('value="14:30"');
    });

    it("does not show another User's Task, nor a Task that doesn't exist", async () => {
      await createUser("alice", "alice-pass");
      const bob = await createUser("bob", "bob-pass");
      const bobsTask = await createTask(bob, { heading: "Bob's secret errand", description: "Nobody else may read this" });

      const someoneElses = await get(`/tasks/${bobsTask}`);

      expect(someoneElses.statusCode).toBe(404);
      expect(someoneElses.body).not.toContain("Nobody else may read this");
      expect((await get("/tasks/000000000000000000000000")).statusCode).toBe(404);
      expect((await get("/tasks/not-an-id")).statusCode).toBe(404);
    });
  });

  describe("edit", () => {
    it("changes the Heading, Description and due date, and redirects back to the Task", async () => {
      const alice = await createUser("alice", "alice-pass", "Asia/Dubai");
      const id = await createTask(alice, {
        heading: "Dentist",
        description: "Check-up",
        transcript: "dentist on tuesday",
        due: { kind: "date", date: "2026-11-03" },
      });

      const response = await post(`/tasks/${id}`, {
        heading: "Dentist appointment",
        description: "Check-up and cleaning",
        due_date: "2026-11-05",
        due_time: "16:15",
      });

      expect(response.statusCode).toBe(303);
      expect(response.headers.location).toBe(`/tasks/${id}`);
      const list = (await get("/tasks")).body;
      expect(list).toContain("Dentist appointment");
      expect(list).toContain("Check-up and cleaning");
      expect(list).toContain("Thu 5 Nov 2026, 16:15");
      expect(list).toContain("dentist on tuesday");
    });

    it("can make a Task date-only, or take its due date away", async () => {
      const alice = await createUser("alice", "alice-pass");
      const id = await createTask(alice, { heading: "Dentist", due: { kind: "moment", at: new Date("2026-11-03T10:30:00Z") } });

      await post(`/tasks/${id}`, { heading: "Dentist", description: "Check-up", due_date: "2026-11-04", due_time: "" });
      expect((await get("/tasks")).body).toMatch(/Due Wed 4 Nov 2026\s*</);

      await post(`/tasks/${id}`, { heading: "Dentist", description: "Check-up", due_date: "", due_time: "" });
      expect((await get("/tasks")).body).toContain("No due date");
    });

    it("refuses an empty Heading, a malformed date, or a time without a date, and leaves the Task as it was", async () => {
      const alice = await createUser("alice", "alice-pass");
      const id = await createTask(alice, { heading: "Dentist", description: "Check-up", due: { kind: "date", date: "2026-11-03" } });

      const refused = [
        await post(`/tasks/${id}`, { heading: " ", description: "x", due_date: "2026-11-04" }),
        await post(`/tasks/${id}`, { heading: "x", description: "x", due_date: "4 Nov" }),
        await post(`/tasks/${id}`, { heading: "x", description: "x", due_date: "2026-02-30" }),
        await post(`/tasks/${id}`, { heading: "x", description: "x", due_date: "2026-11-04", due_time: "25:00" }),
        await post(`/tasks/${id}`, { heading: "x", description: "x", due_date: "", due_time: "10:00" }),
      ];

      expect(refused.map((response) => response.statusCode)).toEqual([400, 400, 400, 400, 400]);
      const list = (await get("/tasks")).body;
      expect(list).toContain("Dentist");
      expect(list).toContain("Tue 3 Nov 2026");
    });

    it("cannot edit another User's Task", async () => {
      await createUser("alice", "alice-pass");
      const bob = await createUser("bob", "bob-pass");
      const bobsTask = await createTask(bob, { heading: "Bob's errand", description: "Original" });

      const response = await post(`/tasks/${bobsTask}`, { heading: "Hijacked", description: "Changed by Alice" });

      expect(response.statusCode).toBe(404);
      const page = (await get("/tasks", ["bob", "bob-pass"])).body;
      expect(page).toContain("Original");
      expect(page).not.toContain("Hijacked");
    });
  });

  describe("Reminders after an edit", () => {
    async function remindersAsOf(asOf: string): Promise<ReminderEvent[]> {
      const sent: ReminderEvent[] = [];
      await sendDueReminders(database(), "UTC", new Date(asOf), async (reminder) => {
        sent.push(reminder);
      });
      return sent;
    }

    it("a changed due date gets a new Reminder at the new time", async () => {
      const alice = await createUser("alice", "alice-pass");
      const id = await createTask(alice, { heading: "Dentist", due: { kind: "moment", at: new Date("2026-11-03T10:00:00Z") } });
      expect(await remindersAsOf("2026-11-03T10:00:00Z")).toHaveLength(1);

      await post(`/tasks/${id}`, { heading: "Dentist", description: "Check-up", due_date: "2026-11-04", due_time: "11:00" });

      expect(await remindersAsOf("2026-11-04T10:59:00Z")).toEqual([]);
      const sent = await remindersAsOf("2026-11-04T11:00:00Z");
      expect(sent.map((reminder) => reminder.due)).toEqual([{ date: "2026-11-04", time: "11:00" }]);
    });

    it("editing only the Heading or Description does not send the Reminder again", async () => {
      const alice = await createUser("alice", "alice-pass");
      const id = await createTask(alice, { heading: "Dentist", due: { kind: "moment", at: new Date("2026-11-03T10:00:00Z") } });
      expect(await remindersAsOf("2026-11-03T10:00:00Z")).toHaveLength(1);

      await post(`/tasks/${id}`, { heading: "Dentist visit", description: "Bring the card", due_date: "2026-11-03", due_time: "10:00" });

      expect(await remindersAsOf("2026-11-03T12:00:00Z")).toEqual([]);
    });
  });

  describe("delete", () => {
    it("removes the Task and redirects to the list", async () => {
      const alice = await createUser("alice", "alice-pass");
      const id = await createTask(alice, { heading: "Call the plumber" });
      await createTask(alice, { heading: "Renew passport" });

      const response = await post(`/tasks/${id}/delete`);

      expect(response.statusCode).toBe(303);
      expect(response.headers.location).toBe("/tasks");
      const list = (await get("/tasks")).body;
      expect(list).not.toContain("Call the plumber");
      expect(list).toContain("Renew passport");
      expect((await get(`/tasks/${id}`)).statusCode).toBe(404);
    });

    it("cannot delete another User's Task", async () => {
      await createUser("alice", "alice-pass");
      const bob = await createUser("bob", "bob-pass");
      const bobsTask = await createTask(bob, { heading: "Bob's errand" });

      expect((await post(`/tasks/${bobsTask}/delete`)).statusCode).toBe(404);
      expect((await get(`/tasks/${bobsTask}`, ["bob", "bob-pass"])).statusCode).toBe(200);
    });
  });

  describe("Markdown copies", () => {
    it("rewrites the User's tasks.md after marking done, reopening, editing and deleting", async () => {
      const alice = await createUser("alice", "alice-pass");
      const id = await createTask(alice, { heading: "Call the plumber", description: "The tap drips" });
      const tasksFile = join(markdownDir, "alice", "tasks.md");

      await post(`/tasks/${id}/done`);
      const afterDone = await readFile(tasksFile, "utf8");
      await post(`/tasks/${id}/reopen`);
      const afterReopen = await readFile(tasksFile, "utf8");
      await post(`/tasks/${id}`, { heading: "Call the plumber today", description: "The tap drips", due_date: "2026-11-04" });
      const afterEdit = await readFile(tasksFile, "utf8");
      await post(`/tasks/${id}/delete`);
      const afterDelete = await readFile(tasksFile, "utf8");

      expect(afterDone).toContain("- [x] Call the plumber");
      expect(afterReopen).toContain("- [ ] Call the plumber");
      expect(afterEdit).toContain("- [ ] Call the plumber today (due Wed 4 Nov 2026)");
      expect(afterDelete).not.toContain("Call the plumber");
    });
  });

  describe("landing page", () => {
    it("redirects / into the dashboard", async () => {
      await createUser("alice", "alice-pass");

      const response = await get("/");

      expect(response.statusCode).toBe(302);
      expect(response.headers.location).toBe("/tasks");
    });
  });
});
