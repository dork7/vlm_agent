import { describe, expect, it } from "vitest";
import { ensureFirstAdmin, findUserByChannelIdentity, verifyPassword } from "../src/users.ts";
import { useMemoryMongo } from "./fakes/memory-mongo.ts";

const firstAdmin = { username: "owner", password: "s3cret", telegramId: "42" };

describe("first admin on startup", () => {
  const database = useMemoryMongo();

  it("creates an admin with a Telegram Channel Identity when there are no Users", async () => {
    await ensureFirstAdmin(database(), firstAdmin);

    const user = await findUserByChannelIdentity(database(), { channel: "telegram", channelId: "42" });
    expect(user).toMatchObject({ username: "owner", isAdmin: true });
    expect(verifyPassword(user!, "s3cret")).toBe(true);
    expect(verifyPassword(user!, "wrong")).toBe(false);
  });

  it("stores the password only as a scrypt hash with a per-user salt", async () => {
    await ensureFirstAdmin(database(), firstAdmin);
    const first = (await database().users.findOne({ username: "owner" }))!;
    await database().users.deleteMany({});
    await ensureFirstAdmin(database(), firstAdmin);
    const second = (await database().users.findOne({ username: "owner" }))!;

    expect(JSON.stringify(first)).not.toContain("s3cret");
    expect(first.password.algorithm).toBe("scrypt");
    expect(second.password.salt).not.toBe(first.password.salt);
    expect(second.password.hash).not.toBe(first.password.hash);
  });

  it("creates nothing when Users already exist", async () => {
    await ensureFirstAdmin(database(), firstAdmin);
    await ensureFirstAdmin(database(), { username: "someone-else", password: "x", telegramId: "7" });

    expect(await database().users.countDocuments()).toBe(1);
    expect(await findUserByChannelIdentity(database(), { channel: "telegram", channelId: "7" })).toBeNull();
  });
});
