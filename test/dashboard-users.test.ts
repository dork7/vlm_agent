import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { createCore, type CoreEvent } from "../src/core/core.ts";
import { createOpenRouter } from "../src/llm/openrouter.ts";
import { buildServer } from "../src/server.ts";
import { hashPassword } from "../src/users.ts";
import { toolCall, useFakeOpenRouter } from "./fakes/fake-openrouter.ts";
import { useMemoryMongo } from "./fakes/memory-mongo.ts";
import { unusedInventory, unusedTranscriber } from "./fakes/unused.ts";

function basicAuth(username: string, password: string) {
  return { authorization: `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}` };
}

const ADMIN: [string, string] = ["root", "root-pass"];
const NON_ADMIN: [string, string] = ["alice", "alice-pass"];

describe("dashboard Users portal", () => {
  const database = useMemoryMongo();
  const openRouter = useFakeOpenRouter();
  let server: FastifyInstance;

  beforeAll(async () => {
    server = buildServer({
      logger: false,
      inventory: { items: [], apiKey: "unused" },
      dashboard: { database: database(), defaultTimezone: "UTC" },
    });
    await server.ready();
  });
  afterAll(async () => {
    await server.close();
  });

  /** Sends a typed message to the bot (Seam 1) as a Telegram sender, returning the final result. */
  function core() {
    const llm = createOpenRouter({ apiKey: "key", baseUrl: openRouter.baseUrl, models: ["test/model-a"] });
    return createCore({ database: database(), llm, inventory: unusedInventory, transcriber: unusedTranscriber, defaultTimezone: "UTC" });
  }

  async function botResult(telegramId: string) {
    openRouter.script("test/model-a", toolCall("save_note", { heading: "A thought" }));
    const events: CoreEvent[] = [];
    await core().handleMessage(
      {
        sender: { channel: "telegram", channelId: telegramId },
        chatId: telegramId,
        messageId: String(Math.random()),
        content: { kind: "text", text: "Remember a thought" },
        clarifyWith: "buttons",
      },
      async (event) => {
        events.push(event);
      },
    );
    const last = events.at(-1);
    return last?.type === "result" ? last.result.kind : last?.type;
  }

  async function createUserDirectly(username: string, password: string, isAdmin: boolean) {
    const { insertedId } = await database().users.insertOne({
      username,
      password: hashPassword(password),
      isAdmin,
      channelIdentities: [],
      createdAt: new Date(),
    });
    return insertedId;
  }

  beforeEach(async () => {
    await createUserDirectly(...ADMIN, true);
    await createUserDirectly(...NON_ADMIN, false);
  });

  function get(url: string, as: [string, string] = ADMIN) {
    return server.inject({ method: "GET", url, headers: basicAuth(...as) });
  }

  function post(url: string, form: Record<string, string> = {}, as: [string, string] = ADMIN) {
    return server.inject({
      method: "POST",
      url,
      headers: { ...basicAuth(...as), "content-type": "application/x-www-form-urlencoded" },
      payload: new URLSearchParams(form).toString(),
    });
  }

  describe("access", () => {
    it("is forbidden to a non-admin User on every page and action", async () => {
      const alice = (await database().users.findOne({ username: "alice" }))!._id!.toHexString();
      const attempts = [
        get("/users", NON_ADMIN),
        get(`/users/${alice}`, NON_ADMIN),
        post("/users", { username: "eve", password: "eve-pass", timezone: "UTC" }, NON_ADMIN),
        post(`/users/${alice}/identities`, { channel: "telegram", channelId: "77" }, NON_ADMIN),
        post(`/users/${alice}/identities/remove`, { channel: "telegram", channelId: "77" }, NON_ADMIN),
        post(`/users/${alice}/timezone`, { timezone: "Asia/Dubai" }, NON_ADMIN),
        post(`/users/${alice}/password`, { password: "new-pass" }, NON_ADMIN),
        post(`/users/${alice}/delete`, {}, NON_ADMIN),
      ];

      for (const response of await Promise.all(attempts)) expect(response.statusCode).toBe(403);
      expect(await database().users.countDocuments()).toBe(2);
      expect(await database().users.findOne({ username: "alice" })).toMatchObject({ channelIdentities: [] });
    });

    it("shows the portal to an admin, listing Users", async () => {
      const response = await get("/users");

      expect(response.statusCode).toBe(200);
      expect(response.body).toContain("root");
      expect(response.body).toContain("alice");
    });
  });

  async function createUser(form: Record<string, string>) {
    const response = await post("/users", { timezone: "UTC", ...form });
    expect(response.statusCode).toBe(303);
    return response.headers.location as string;
  }

  describe("create a User", () => {
    it("lets the new User log in with the given password, which is stored only as a hash", async () => {
      const response = await post("/users", { username: "sam", password: "sam-secret-pass", timezone: "Asia/Dubai" });

      expect(response.statusCode).toBe(303);
      expect(response.headers.location).toMatch(/^\/users\/[0-9a-f]{24}$/);
      expect((await get("/notes", ["sam", "sam-secret-pass"])).statusCode).toBe(200);
      expect((await get("/notes", ["sam", "wrong"])).statusCode).toBe(401);
      const stored = await database().users.findOne({ username: "sam" });
      expect(JSON.stringify(stored)).not.toContain("sam-secret-pass");
      expect(stored).toMatchObject({ isAdmin: false, timezone: "Asia/Dubai", channelIdentities: [] });
    });

    it("shows the new User's page", async () => {
      const page = await createUser({ username: "sam", password: "sam-pass", timezone: "Asia/Dubai" });

      const response = await get(page);

      expect(response.statusCode).toBe(200);
      expect(response.body).toContain("sam");
      expect(response.body).toContain("Asia/Dubai");
    });

    it("can make the new User an admin", async () => {
      await createUser({ username: "sam", password: "sam-pass", isAdmin: "on" });

      expect((await get("/users", ["sam", "sam-pass"])).statusCode).toBe(200);
    });

    it("refuses a missing username or password, a taken username, and an unknown timezone", async () => {
      const attempts = await Promise.all([
        post("/users", { username: " ", password: "pw", timezone: "UTC" }),
        post("/users", { username: "sam", password: "", timezone: "UTC" }),
        post("/users", { username: "alice", password: "pw", timezone: "UTC" }),
        post("/users", { username: "sam", password: "pw", timezone: "Mars/Olympus" }),
      ]);

      for (const response of attempts) expect(response.statusCode).toBe(400);
      expect(await database().users.countDocuments()).toBe(2);
      expect((await get("/notes", ["alice", "pw"])).statusCode).toBe(401);
    });
  });

  describe("Channel Identities", () => {
    it("adding a Telegram Channel Identity lets that sender use the bot", async () => {
      const page = await createUser({ username: "sam", password: "sam-pass" });
      expect(await botResult("555")).toBe("refused");

      const response = await post(`${page}/identities`, { channel: "telegram", channelId: " 555 " });

      expect(response.statusCode).toBe(303);
      expect(response.headers.location).toBe(page);
      expect((await get(page)).body).toContain("555");
      expect(await botResult("555")).toBe("note-saved");
      const sam = await database().users.findOne({ username: "sam" });
      expect(await database().notes.findOne({ ownerId: sam!._id! })).toMatchObject({ heading: "A thought" });
    });

    it("removing it makes the bot refuse that sender", async () => {
      const page = await createUser({ username: "sam", password: "sam-pass" });
      await post(`${page}/identities`, { channel: "telegram", channelId: "555" });
      await post(`${page}/identities`, { channel: "telegram", channelId: "556" });

      const response = await post(`${page}/identities/remove`, { channel: "telegram", channelId: "555" });

      expect(response.statusCode).toBe(303);
      expect(await botResult("555")).toBe("refused");
      expect(await botResult("556")).toBe("note-saved");
    });

    it("cannot belong to two Users", async () => {
      const sam = await createUser({ username: "sam", password: "sam-pass" });
      const kim = await createUser({ username: "kim", password: "kim-pass" });
      await post(`${sam}/identities`, { channel: "telegram", channelId: "555" });

      const response = await post(`${kim}/identities`, { channel: "telegram", channelId: "555" });

      expect(response.statusCode).toBe(400);
      expect((await get(kim)).body).not.toContain("555");
      await botResult("555");
      const samId = (await database().users.findOne({ username: "sam" }))!._id!;
      expect(await database().notes.countDocuments({ ownerId: samId })).toBe(1);
    });

    it("may be the same ID on a different Channel for another User", async () => {
      const sam = await createUser({ username: "sam", password: "sam-pass" });
      const kim = await createUser({ username: "kim", password: "kim-pass" });
      await post(`${sam}/identities`, { channel: "telegram", channelId: "555" });

      const response = await post(`${kim}/identities`, { channel: "whatsapp", channelId: "555" });

      expect(response.statusCode).toBe(303);
    });

    it("refuses an empty Channel ID, and adding one the User already has changes nothing", async () => {
      const page = await createUser({ username: "sam", password: "sam-pass" });
      await post(`${page}/identities`, { channel: "telegram", channelId: "555" });

      const empty = await post(`${page}/identities`, { channel: "telegram", channelId: "  " });
      const again = await post(`${page}/identities`, { channel: "telegram", channelId: "555" });

      expect(empty.statusCode).toBe(400);
      expect(again.statusCode).toBe(303);
      expect((await database().users.findOne({ username: "sam" }))!.channelIdentities).toEqual([
        { channel: "telegram", channelId: "555" },
      ]);
    });

    it("is not found for a User that doesn't exist", async () => {
      const response = await post("/users/000000000000000000000000/identities", { channel: "telegram", channelId: "555" });

      expect(response.statusCode).toBe(404);
      expect(await botResult("555")).toBe("refused");
    });
  });

  describe("reset a password", () => {
    it("makes the old password fail and the new one work", async () => {
      const alice = (await database().users.findOne({ username: "alice" }))!._id!;

      const response = await post(`/users/${alice}/password`, { password: "fresh-pass" });

      expect(response.statusCode).toBe(303);
      expect(response.headers.location).toBe(`/users/${alice}`);
      expect((await get("/notes", NON_ADMIN)).statusCode).toBe(401);
      expect((await get("/notes", ["alice", "fresh-pass"])).statusCode).toBe(200);
      expect(JSON.stringify(await database().users.findOne({ _id: alice }))).not.toContain("fresh-pass");
    });

    it("refuses an empty password and keeps the old one", async () => {
      const alice = (await database().users.findOne({ username: "alice" }))!._id!;

      const response = await post(`/users/${alice}/password`, { password: "" });

      expect(response.statusCode).toBe(400);
      expect((await get("/notes", NON_ADMIN)).statusCode).toBe(200);
    });
  });

  describe("set a timezone", () => {
    it("changes the User's timezone, and an empty one goes back to the default", async () => {
      const page = await createUser({ username: "sam", password: "sam-pass", timezone: "UTC" });

      const set = await post(`${page}/timezone`, { timezone: "Asia/Dubai" });
      const afterSet = await database().users.findOne({ username: "sam" });
      const cleared = await post(`${page}/timezone`, { timezone: "" });
      const afterClear = await database().users.findOne({ username: "sam" });

      expect(set.statusCode).toBe(303);
      expect(afterSet!.timezone).toBe("Asia/Dubai");
      expect(cleared.statusCode).toBe(303);
      expect(afterClear!.timezone).toBeUndefined();
    });

    it("refuses an unknown timezone and keeps the old one", async () => {
      const page = await createUser({ username: "sam", password: "sam-pass", timezone: "Asia/Dubai" });

      const response = await post(`${page}/timezone`, { timezone: "Mars/Olympus" });

      expect(response.statusCode).toBe(400);
      expect((await get(page)).body).toContain("Asia/Dubai");
    });
  });

  describe("delete a User", () => {
    it("makes both dashboard login and bot use fail for them", async () => {
      const page = await createUser({ username: "sam", password: "sam-pass" });
      await post(`${page}/identities`, { channel: "telegram", channelId: "555" });
      expect(await botResult("555")).toBe("note-saved");

      const response = await post(`${page}/delete`);

      expect(response.statusCode).toBe(303);
      expect(response.headers.location).toBe("/users");
      expect((await get("/notes", ["sam", "sam-pass"])).statusCode).toBe(401);
      expect(await botResult("555")).toBe("refused");
      expect((await get(page)).statusCode).toBe(404);
      expect((await get("/users")).body).not.toContain("sam");
    });

    it("removes their Notes and Tasks, so no Reminder goes out to them afterwards", async () => {
      const page = await createUser({ username: "sam", password: "sam-pass" });
      await post(`${page}/identities`, { channel: "telegram", channelId: "555" });
      await botResult("555");
      const sam = (await database().users.findOne({ username: "sam" }))!._id!;
      const at = new Date("2026-10-27T05:30:00Z");
      await database().tasks.insertOne({
        ownerId: sam,
        heading: "Call the bank",
        description: "",
        due: { kind: "moment", at: new Date("2026-10-28T09:00:00Z") },
        status: "open",
        reminderSentAt: null,
        channelIdentity: { channel: "telegram", channelId: "555" },
        transcript: "call the bank tomorrow",
        source: { channel: "telegram", chatId: "555", messageId: "1" },
        createdAt: at,
        updatedAt: at,
      });

      await post(`${page}/delete`);

      const reminders: unknown[] = [];
      await core().sendDueReminders(new Date("2026-10-29T00:00:00Z"), async (reminder) => {
        reminders.push(reminder);
      });
      expect(reminders).toEqual([]);
      expect(await database().notes.countDocuments({ ownerId: sam })).toBe(0);
      expect(await database().tasks.countDocuments({ ownerId: sam })).toBe(0);
    });

    it("lets the deleted User's Channel Identity be given to someone else", async () => {
      const sam = await createUser({ username: "sam", password: "sam-pass" });
      const kim = await createUser({ username: "kim", password: "kim-pass" });
      await post(`${sam}/identities`, { channel: "telegram", channelId: "555" });
      await post(`${sam}/delete`);

      expect((await post(`${kim}/identities`, { channel: "telegram", channelId: "555" })).statusCode).toBe(303);
    });

    it("leaves other Users alone, and an admin cannot delete themselves", async () => {
      const root = (await database().users.findOne({ username: "root" }))!._id!;
      const page = await createUser({ username: "sam", password: "sam-pass" });

      await post(`${page}/delete`);
      const self = await post(`/users/${root}/delete`);

      expect(self.statusCode).toBe(400);
      expect((await get("/users")).statusCode).toBe(200);
      expect((await get("/notes", NON_ADMIN)).statusCode).toBe(200);
      expect((await post("/users/000000000000000000000000/delete")).statusCode).toBe(404);
    });
  });
});
