import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import type { ChannelIdentity, Database, PasswordHash, UserDoc } from "./db.ts";

const KEY_LENGTH = 64;

export function hashPassword(password: string): PasswordHash {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, KEY_LENGTH);
  return { algorithm: "scrypt", salt: salt.toString("base64"), hash: hash.toString("base64") };
}

export function verifyPassword(user: Pick<UserDoc, "password">, password: string): boolean {
  const expected = Buffer.from(user.password.hash, "base64");
  const actual = scryptSync(password, Buffer.from(user.password.salt, "base64"), expected.length);
  return timingSafeEqual(actual, expected);
}

export function findUserByChannelIdentity(
  database: Database,
  identity: ChannelIdentity,
): Promise<UserDoc | null> {
  return database.users.findOne({ channelIdentities: { $elemMatch: identity } });
}

/** On startup with no Users, creates the first admin from configuration. */
export async function ensureFirstAdmin(
  database: Database,
  admin: { username: string; password: string; telegramId: string },
): Promise<void> {
  if ((await database.users.countDocuments({}, { limit: 1 })) > 0) return;

  await database.users.insertOne({
    username: admin.username,
    password: hashPassword(admin.password),
    isAdmin: true,
    channelIdentities: [{ channel: "telegram", channelId: admin.telegramId }],
    createdAt: new Date(),
  });
}
