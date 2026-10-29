import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { ObjectId } from "mongodb";
import { buildServer } from "../src/server.ts";
import { hashPassword } from "../src/users.ts";
import { useMemoryMongo } from "./fakes/memory-mongo.ts";

function basicAuth(username: string, password: string) {
  return { authorization: `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}` };
}

describe("dashboard Notes page", () => {
  const database = useMemoryMongo();
  let server: FastifyInstance;
  let markdownDir: string;

  beforeAll(async () => {
    markdownDir = await mkdtemp(join(tmpdir(), "dashboard-markdown-"));
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

  async function createUser(username: string, password: string): Promise<ObjectId> {
    const { insertedId } = await database().users.insertOne({
      username,
      password: hashPassword(password),
      isAdmin: false,
      channelIdentities: [],
      createdAt: new Date(),
    });
    return insertedId;
  }

  let clock = Date.parse("2026-10-01T09:00:00Z");
  async function createNote(ownerId: ObjectId, note: { heading: string; text: string; transcript?: string }) {
    const at = new Date((clock += 60_000));
    const { insertedId } = await database().notes.insertOne({
      ownerId,
      heading: note.heading,
      text: note.text,
      transcript: note.transcript ?? note.text,
      source: { channel: "telegram", chatId: "42", messageId: String(clock) },
      createdAt: at,
      updatedAt: at,
    });
    return insertedId;
  }

  function get(url: string, as: [string, string] = ["alice", "alice-pass"]) {
    return server.inject({ method: "GET", url, headers: basicAuth(...as) });
  }

  describe("login", () => {
    it("asks for credentials when none are given", async () => {
      await createUser("alice", "alice-pass");

      const response = await server.inject({ method: "GET", url: "/notes" });

      expect(response.statusCode).toBe(401);
      expect(response.headers["www-authenticate"]).toMatch(/^Basic /);
    });

    it("refuses a wrong password and an unknown username", async () => {
      await createUser("alice", "alice-pass");

      const wrongPassword = await server.inject({ method: "GET", url: "/notes", headers: basicAuth("alice", "nope") });
      const unknownUser = await server.inject({ method: "GET", url: "/notes", headers: basicAuth("mallory", "alice-pass") });

      expect(wrongPassword.statusCode).toBe(401);
      expect(unknownUser.statusCode).toBe(401);
    });

    it("shows the Notes page to a User with the right password", async () => {
      await createUser("alice", "alice-pass");

      const response = await server.inject({ method: "GET", url: "/notes", headers: basicAuth("alice", "alice-pass") });

      expect(response.statusCode).toBe(200);
      expect(response.headers["content-type"]).toMatch(/text\/html/);
    });
  });

  describe("list", () => {
    it("lists only the User's own Notes, newest first", async () => {
      const alice = await createUser("alice", "alice-pass");
      const bob = await createUser("bob", "bob-pass");
      await createNote(alice, { heading: "Call the plumber", text: "The kitchen tap drips" });
      await createNote(bob, { heading: "Bob's secret plan", text: "Nobody else may read this" });
      await createNote(alice, { heading: "Gift idea for Sam", text: "A blue mug" });

      const page = (await get("/notes")).body;

      expect(page).toContain("Call the plumber");
      expect(page).toContain("Gift idea for Sam");
      expect(page).not.toContain("Bob&#39;s secret plan");
      expect(page).not.toContain("Bob's secret plan");
      expect(page.indexOf("Gift idea for Sam")).toBeLessThan(page.indexOf("Call the plumber"));
    });

    it("says so when the User has no Notes", async () => {
      await createUser("alice", "alice-pass");

      expect((await get("/notes")).body).toContain("No Notes yet");
    });
  });

  describe("search", () => {
    it("finds Notes whose Heading or text matches, ignoring case", async () => {
      const alice = await createUser("alice", "alice-pass");
      const bob = await createUser("bob", "bob-pass");
      await createNote(alice, { heading: "Mug supplier", text: "Ask about prices" });
      await createNote(alice, { heading: "Gift idea", text: "A blue MUG for Sam" });
      await createNote(alice, { heading: "Call the plumber", text: "The kitchen tap drips" });
      await createNote(bob, { heading: "Bob's mug", text: "Mine" });

      const page = (await get("/notes?q=mug")).body;

      expect(page).toContain("Mug supplier");
      expect(page).toContain("Gift idea");
      expect(page).not.toContain("Call the plumber");
      expect(page).not.toContain("Bob");
    });

    it("treats the search as plain text, not a pattern", async () => {
      const alice = await createUser("alice", "alice-pass");
      await createNote(alice, { heading: "Price list", text: "Mugs cost $5 (each)" });
      await createNote(alice, { heading: "Anything", text: "Something else" });

      const page = (await get(`/notes?q=${encodeURIComponent("$5 (each)")}`)).body;

      expect(page).toContain("Price list");
      expect(page).not.toContain("Anything");
    });

    it("says so when nothing matches", async () => {
      const alice = await createUser("alice", "alice-pass");
      await createNote(alice, { heading: "Call the plumber", text: "The kitchen tap drips" });

      const page = (await get("/notes?q=dentist")).body;

      expect(page).not.toContain("Call the plumber");
      expect(page).toContain("No Notes match");
    });
  });

  describe("open", () => {
    it("shows a Note's Heading, text and original Transcript", async () => {
      const alice = await createUser("alice", "alice-pass");
      const id = await createNote(alice, {
        heading: "Gift idea for Sam",
        text: "Buy Sam a blue mug",
        transcript: "um so remember to buy sam a blue mug yeah",
      });

      const response = await get(`/notes/${id}`);

      expect(response.statusCode).toBe(200);
      expect(response.body).toContain("Gift idea for Sam");
      expect(response.body).toContain("Buy Sam a blue mug");
      expect(response.body).toContain("um so remember to buy sam a blue mug yeah");
    });

    it("escapes what was said, so a Note cannot inject markup", async () => {
      const alice = await createUser("alice", "alice-pass");
      const id = await createNote(alice, { heading: "<script>alert(1)</script>", text: "<b>bold</b>" });

      const page = (await get(`/notes/${id}`)).body;

      expect(page).not.toContain("<script>alert(1)</script>");
      expect(page).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    });

    it("does not show another User's Note, nor a Note that doesn't exist", async () => {
      await createUser("alice", "alice-pass");
      const bob = await createUser("bob", "bob-pass");
      const bobsNote = await createNote(bob, { heading: "Bob's secret plan", text: "Nobody else may read this" });

      const someoneElses = await get(`/notes/${bobsNote}`);
      const missing = await get("/notes/000000000000000000000000");
      const malformed = await get("/notes/not-an-id");

      expect(someoneElses.statusCode).toBe(404);
      expect(someoneElses.body).not.toContain("Nobody else may read this");
      expect(missing.statusCode).toBe(404);
      expect(malformed.statusCode).toBe(404);
    });
  });

  function post(url: string, form: Record<string, string> = {}, as: [string, string] = ["alice", "alice-pass"]) {
    return server.inject({
      method: "POST",
      url,
      headers: { ...basicAuth(...as), "content-type": "application/x-www-form-urlencoded" },
      payload: new URLSearchParams(form).toString(),
    });
  }

  describe("edit", () => {
    it("changes the Heading and text, keeps the original Transcript, and redirects back to the Note", async () => {
      const alice = await createUser("alice", "alice-pass");
      const id = await createNote(alice, {
        heading: "Gift idea for Sam",
        text: "Buy Sam a blue mag",
        transcript: "remember to buy sam a blue mag",
      });

      const response = await post(`/notes/${id}`, { heading: "Birthday gift for Sam", text: "Buy Sam a blue mug" });

      expect(response.statusCode).toBe(303);
      expect(response.headers.location).toBe(`/notes/${id}`);
      const page = (await get(`/notes/${id}`)).body;
      expect(page).toContain("Birthday gift for Sam");
      expect(page).toContain("Buy Sam a blue mug");
      expect(page).not.toContain("Gift idea for Sam");
      expect(page).toContain("remember to buy sam a blue mag");
      expect((await get("/notes")).body).toContain("Birthday gift for Sam");
    });

    it("refuses an empty Heading or text and leaves the Note as it was", async () => {
      const alice = await createUser("alice", "alice-pass");
      const id = await createNote(alice, { heading: "Gift idea for Sam", text: "Buy Sam a blue mug" });

      const noHeading = await post(`/notes/${id}`, { heading: "  ", text: "Something" });
      const noText = await post(`/notes/${id}`, { heading: "Something" });

      expect(noHeading.statusCode).toBe(400);
      expect(noText.statusCode).toBe(400);
      const page = (await get(`/notes/${id}`)).body;
      expect(page).toContain("Gift idea for Sam");
      expect(page).toContain("Buy Sam a blue mug");
    });

    it("cannot edit another User's Note", async () => {
      await createUser("alice", "alice-pass");
      const bob = await createUser("bob", "bob-pass");
      const bobsNote = await createNote(bob, { heading: "Bob's plan", text: "Original text" });

      const response = await post(`/notes/${bobsNote}`, { heading: "Hijacked", text: "Changed by Alice" });

      expect(response.statusCode).toBe(404);
      const page = (await get(`/notes/${bobsNote}`, ["bob", "bob-pass"])).body;
      expect(page).toContain("Original text");
      expect(page).not.toContain("Hijacked");
    });
  });

  describe("delete", () => {
    it("removes the Note from the list and redirects to it", async () => {
      const alice = await createUser("alice", "alice-pass");
      const id = await createNote(alice, { heading: "Call the plumber", text: "The kitchen tap drips" });
      await createNote(alice, { heading: "Gift idea for Sam", text: "A blue mug" });

      const response = await post(`/notes/${id}/delete`);

      expect(response.statusCode).toBe(303);
      expect(response.headers.location).toBe("/notes");
      const list = (await get("/notes")).body;
      expect(list).not.toContain("Call the plumber");
      expect(list).toContain("Gift idea for Sam");
      expect((await get(`/notes/${id}`)).statusCode).toBe(404);
    });

    it("cannot delete another User's Note", async () => {
      await createUser("alice", "alice-pass");
      const bob = await createUser("bob", "bob-pass");
      const bobsNote = await createNote(bob, { heading: "Bob's plan", text: "Keep this" });

      const response = await post(`/notes/${bobsNote}/delete`);

      expect(response.statusCode).toBe(404);
      expect((await get(`/notes/${bobsNote}`, ["bob", "bob-pass"])).statusCode).toBe(200);
    });
  });

  describe("Markdown copies", () => {
    it("rewrites the User's notes.md after an edit and after a delete", async () => {
      const alice = await createUser("alice", "alice-pass");
      const kept = await createNote(alice, { heading: "Gift idea for Sam", text: "Buy Sam a blue mag" });
      const removed = await createNote(alice, { heading: "Call the plumber", text: "The kitchen tap drips" });
      const notesFile = join(markdownDir, "alice", "notes.md");

      await post(`/notes/${kept}`, { heading: "Birthday gift for Sam", text: "Buy Sam a blue mug" });
      const afterEdit = await readFile(notesFile, "utf8");
      await post(`/notes/${removed}/delete`);
      const afterDelete = await readFile(notesFile, "utf8");

      expect(afterEdit).toContain("## Birthday gift for Sam");
      expect(afterEdit).toContain("Buy Sam a blue mug");
      expect(afterEdit).toContain("## Call the plumber");
      expect(afterDelete).toContain("## Birthday gift for Sam");
      expect(afterDelete).not.toContain("Call the plumber");
    });
  });
});
