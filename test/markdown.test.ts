import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createCore, type CoreEvent } from "../src/core/core.ts";
import { createOpenRouter } from "../src/llm/openrouter.ts";
import { ensureFirstAdmin, findUserByChannelIdentity, hashPassword } from "../src/users.ts";
import { toolCall, useFakeOpenRouter } from "./fakes/fake-openrouter.ts";
import { useMemoryMongo } from "./fakes/memory-mongo.ts";
import { unusedInventory } from "./fakes/unused-inventory.ts";

const MODEL = "test/model-a";

describe("core: Markdown copies of Tasks and Notes", () => {
  const database = useMemoryMongo();
  const openRouter = useFakeOpenRouter();
  let markdownDir: string;
  // Each message is handled one minute after the previous, from Tuesday 27 October 2026, 09:30 in Dubai.
  let clock: number;

  beforeEach(async () => {
    markdownDir = await mkdtemp(join(tmpdir(), "markdown-copies-"));
    clock = Date.parse("2026-10-27T05:30:00Z");
  });
  afterEach(() => rm(markdownDir, { recursive: true, force: true }));

  async function send(text: string, reply: ReturnType<typeof toolCall>, options: { dir?: string; senderId?: string } = {}) {
    await ensureFirstAdmin(database(), { username: "owner", password: "pw", telegramId: "42", timezone: "Asia/Dubai" });
    openRouter.script(MODEL, reply);
    const llm = createOpenRouter({ apiKey: "key", baseUrl: openRouter.baseUrl, models: [MODEL] });
    const now = new Date(clock);
    clock += 60_000;
    const core = createCore({
      database: database(),
      llm,
      inventory: unusedInventory,
      defaultTimezone: "UTC",
      markdownDir: options.dir ?? markdownDir,
      now: () => now,
    });
    const events: CoreEvent[] = [];
    await core.handleMessage(
      {
        sender: { channel: "telegram", channelId: options.senderId ?? "42" },
        chatId: "chat",
        messageId: String(clock),
        content: { kind: "text", text },
      },
      async (event) => {
        events.push(event);
      },
    );
    return events;
  }

  const task = (heading: string, description: string, due: { due_date?: string; due_time?: string } = {}) =>
    toolCall("save_task", { heading, description, ...due });
  const note = (heading: string) => toolCall("save_note", { heading });
  const read = (username: string, file: string) => readFile(join(markdownDir, username, file), "utf8");

  it("writes the User's Tasks as a checklist: open soonest due first, undated after, done ticked", async () => {
    await send("Fix the shelf", task("Fix the shelf", "Fix the wobbly shelf\nin the back room."));
    await send("Call the supplier", task("Call the supplier", "Call about the delivery.", { due_date: "2026-10-30", due_time: "15:00" }));
    await send("Send the invoice", task("Send the invoice", "Send it.", { due_date: "2026-10-28" }));
    const owner = await findUserByChannelIdentity(database(), { channel: "telegram", channelId: "42" });
    await database().tasks.updateOne({ ownerId: owner!._id!, heading: "Send the invoice" }, { $set: { status: "done" } });
    await send("Order mugs", task("Order mugs", "Order blue mugs.", { due_date: "2026-11-02" }));

    expect(await read("owner", "tasks.md")).toBe(
      [
        "# Tasks",
        "",
        "- [ ] Call the supplier (due Fri 30 Oct 2026, 15:00)",
        "  Call about the delivery.",
        "- [ ] Order mugs (due Mon 2 Nov 2026)",
        "  Order blue mugs.",
        "- [ ] Fix the shelf",
        "  Fix the wobbly shelf",
        "  in the back room.",
        "- [x] Send the invoice (due Wed 28 Oct 2026)",
        "  Send it.",
        "",
      ].join("\n"),
    );
  });

  it("writes the User's Notes newest first with when they were saved, in the User's timezone", async () => {
    await send("Remember oat milk is cheaper at the market", note("Oat milk cheaper at the market"));
    await send("Remember the supplier closes early on Fridays", note("Supplier closes early on Fridays"));

    expect(await read("owner", "notes.md")).toBe(
      [
        "# Notes",
        "",
        "## Supplier closes early on Fridays",
        "",
        "_Tue 27 Oct 2026, 09:31_",
        "",
        "Remember the supplier closes early on Fridays",
        "",
        "## Oat milk cheaper at the market",
        "",
        "_Tue 27 Oct 2026, 09:30_",
        "",
        "Remember oat milk is cheaper at the market",
        "",
      ].join("\n"),
    );
    expect(await read("owner", "tasks.md")).toBe("# Tasks\n\nNo Tasks yet.\n");
  });

  it("keeps each User's copies in their own folder with only their own Tasks and Notes", async () => {
    await ensureFirstAdmin(database(), { username: "owner", password: "pw", telegramId: "42", timezone: "Asia/Dubai" });
    await database().users.insertOne({
      username: "colleague",
      password: hashPassword("pw"),
      isAdmin: false,
      timezone: "Asia/Dubai",
      channelIdentities: [{ channel: "telegram", channelId: "77" }],
      createdAt: new Date(),
    });

    await send("Call the supplier", task("Call the supplier", "Call."));
    await send("Colleague's plan", task("Colleague's secret plan", "Secret."), { senderId: "77" });

    expect(await read("owner", "tasks.md")).not.toContain("Colleague");
    expect(await read("colleague", "tasks.md")).toContain("Colleague's secret plan");
    expect(await read("colleague", "tasks.md")).not.toContain("Call the supplier");
  });

  it("rebuilds the copies from MongoDB on every change, undoing hand edits", async () => {
    await send("Call the supplier", task("Call the supplier", "Call."));
    await writeFile(join(markdownDir, "owner", "tasks.md"), "- [x] something I typed by hand\n");

    await send("Remember the wifi password", note("Wifi password location"));

    expect(await read("owner", "tasks.md")).toBe("# Tasks\n\n- [ ] Call the supplier\n  Call.\n");
  });

  it("still saves and replies when the copies can't be written", async () => {
    const notADirectory = join(markdownDir, "a-file");
    await writeFile(notADirectory, "");

    const events = await send("Call the supplier", task("Call the supplier", "Call."), { dir: notADirectory });

    expect(events.at(-1)).toEqual({
      type: "result",
      result: { kind: "task-saved", heading: "Call the supplier", due: null },
    });
    expect(await database().tasks.countDocuments()).toBe(1);
  });
});
