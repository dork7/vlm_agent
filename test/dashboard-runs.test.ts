import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { ObjectId } from "mongodb";
import type { RunDoc, RunStage } from "../src/db.ts";
import { buildServer } from "../src/server.ts";
import { hashPassword } from "../src/users.ts";
import { useMemoryMongo } from "./fakes/memory-mongo.ts";

function basicAuth(username: string, password: string) {
  return { authorization: `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}` };
}

describe("dashboard: observability of Runs", () => {
  const database = useMemoryMongo();
  let server: FastifyInstance;

  beforeAll(async () => {
    server = buildServer({
      logger: false,
      inventory: { items: [], apiKey: "unused" },
      dashboard: { database: database(), defaultTimezone: "UTC" },
    });
    await server.ready();
  });
  afterAll(() => server.close());

  async function createUsers() {
    for (const [username, isAdmin] of [
      ["admin", true],
      ["bob", false],
    ] as const) {
      await database().users.insertOne({
        username,
        password: hashPassword(`${username}-pass`),
        isAdmin,
        channelIdentities: [],
        createdAt: new Date(),
      });
    }
  }

  function stage(name: RunStage["name"], durationMs: number, extra: Partial<RunStage> = {}): RunStage {
    return { name, startedAt: new Date("2026-10-20T10:00:00Z"), durationMs, outcome: "succeeded", details: {}, ...extra };
  }

  async function createRun(run: Partial<RunDoc> = {}): Promise<ObjectId> {
    const startedAt = run.startedAt ?? new Date("2026-10-20T10:00:00Z");
    const { insertedId } = await database().runs.insertOne({
      sender: { channel: "telegram", channelId: "42" },
      chatId: "chat-42",
      messageId: String(Math.random()),
      content: "text",
      userId: null,
      username: "owner",
      status: "succeeded",
      type: "note",
      clarificationId: null,
      stages: [stage("received", 3), stage("classification", 800), stage("reply", 40)],
      error: null,
      startedAt,
      finishedAt: new Date(startedAt.getTime() + 843),
      durationMs: 843,
      ...run,
    });
    return insertedId;
  }

  const get = (url: string, as: "admin" | "bob" = "admin") =>
    server.inject({ method: "GET", url, headers: basicAuth(as, `${as}-pass`) });

  describe("the Run list", () => {
    it("shows an admin recent Runs, newest first, with their outcome and total time", async () => {
      await createUsers();
      const older = await createRun({ startedAt: new Date("2026-10-20T09:00:00Z"), status: "failed", type: null, durationMs: 120 });
      const newer = await createRun({ startedAt: new Date("2026-10-21T09:00:00Z"), durationMs: 1843 });

      const response = await get("/runs");

      expect(response.statusCode).toBe(200);
      const { body } = response;
      expect(body.indexOf(`/runs/${newer}`)).toBeGreaterThan(-1);
      expect(body.indexOf(`/runs/${newer}`)).toBeLessThan(body.indexOf(`/runs/${older}`));
      expect(body).toContain("1.84 s");
      expect(body).toContain("120 ms");
      expect(body).toMatch(/failed/i);
      expect(body).toMatch(/succeeded/i);
    });

    it("is denied to a User who is not an admin", async () => {
      await createUsers();
      await createRun();

      const response = await get("/runs", "bob");

      expect(response.statusCode).toBe(403);
    });

    it("clearly marks Runs awaiting a Clarification and says how many are waiting", async () => {
      await createUsers();
      await createRun({ status: "awaiting-clarification", type: null });
      await createRun({ status: "awaiting-clarification", type: null });
      await createRun();

      const { body } = await get("/runs");

      expect(body.match(/<span class="status status-awaiting-clarification">Awaiting Clarification<\/span>/g)).toHaveLength(2);
      expect(body).toContain("2 Runs awaiting a Clarification");
    });

    it("shows admins a link to the Runs, and other Users none", async () => {
      await createUsers();

      expect((await get("/notes")).body).toContain('href="/runs"');
      expect((await get("/notes", "bob")).body).not.toContain('href="/runs"');
    });
  });

  describe("totals", () => {
    it("shows messages per day, counts by type, failure rate, average time per stage and how often fallback happened", async () => {
      await createUsers();
      const day1 = new Date("2026-10-20T10:00:00Z");
      const day2 = new Date("2026-10-21T10:00:00Z");
      await createRun({ startedAt: day1, type: "note" });
      await createRun({
        startedAt: day1,
        type: "task",
        stages: [
          stage("received", 3),
          stage("classification", 800, {
            details: { attempts: [{ model: "a", outcome: "failed", reason: "429" }, { model: "b", outcome: "succeeded" }] },
          }),
          stage("reply", 40),
        ],
      });
      await createRun({
        startedAt: day2,
        type: "query",
        stages: [stage("received", 3), stage("classification", 1200), stage("reply", 40)],
      });
      await createRun({ startedAt: day2, type: null, status: "failed" });
      await createRun({ startedAt: day2, type: "note" });

      const response = await get("/runs/totals");

      expect(response.statusCode).toBe(200);
      const text = response.body.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
      expect(text).toContain("Tue 20 Oct 2026 2");
      expect(text).toContain("Wed 21 Oct 2026 3");
      expect(text).toContain("Note 2");
      expect(text).toContain("Task 1");
      expect(text).toContain("Query 1");
      expect(text).toContain("Failure rate 20% (1 of 5)");
      expect(text).toContain("classification 880 ms");
      expect(text).toContain("received 3 ms");
      expect(text).toContain("Fallback 20% (1 of 5)");
    });

    it("counts a message answered through a Clarification once, under the type the answer gave it", async () => {
      await createUsers();
      const day = new Date("2026-10-20T10:00:00Z");
      // The Run that asked takes the type once answered; the answering Run has none.
      await createRun({ startedAt: day, type: "task" });
      await createRun({ startedAt: day, type: null, content: "clarification-answer" });

      const text = (await get("/runs/totals")).body.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

      expect(text).toContain("Tue 20 Oct 2026 1");
      expect(text).toContain("Task 1");
      expect(text).toContain("Note 0");
    });

    it("is denied to a User who is not an admin", async () => {
      await createUsers();

      expect((await get("/runs/totals", "bob")).statusCode).toBe(403);
    });
  });

  describe("a Run's detail page", () => {
    it("shows each stage with its timing and outcome, the model attempts, the tool calls and the error", async () => {
      await createUsers();
      const id = await createRun({
        status: "failed",
        type: null,
        stages: [
          stage("received", 2),
          stage("classification", 1450, {
            details: {
              attempts: [
                { model: "test/first", outcome: "failed", reason: "OpenRouter test/first responded 429: rate limited" },
                {
                  model: "test/second",
                  outcome: "succeeded",
                  tokens: { prompt: 118, completion: 12, total: 130 },
                  cost: 0.00042,
                },
              ],
            },
          }),
          stage("tool-call", 37, {
            outcome: "failed",
            error: "HTTP 500",
            details: { tool: "search_items", endpoint: "/inventory/items?name=mug", status: 500, latencyMs: 37 },
          }),
          stage("reply", 51),
        ],
        error: { stage: "tool-call", message: "Inventory API responded 500 to /inventory/items?name=mug" },
      });

      const response = await get(`/runs/${id}`);

      expect(response.statusCode).toBe(200);
      const { body } = response;
      for (const text of [
        "received",
        "classification",
        "tool-call",
        "reply",
        "1.45 s",
        "test/first",
        "rate limited",
        "test/second",
        "130",
        "$0.00042",
        "search_items",
        "/inventory/items?name=mug",
        "500",
        "37 ms",
        "Inventory API responded 500",
      ]) {
        expect(body).toContain(text);
      }
      expect(body).toMatch(/Failed in.*tool-call/s);
    });

    it("is denied to a User who is not an admin, and not found for an unknown Run", async () => {
      await createUsers();
      const id = await createRun();

      expect((await get(`/runs/${id}`, "bob")).statusCode).toBe(403);
      expect((await get("/runs/0123456789abcdef01234567")).statusCode).toBe(404);
      expect((await get("/runs/not-an-id")).statusCode).toBe(404);
    });
  });
});
