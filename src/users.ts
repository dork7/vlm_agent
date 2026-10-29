import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import type { ObjectId } from "mongodb";
import { isDuplicateKeyError, type ChannelIdentity, type Database, type PasswordHash, type UserDoc } from "./db.ts";
import { isValidTimezone } from "./time.ts";

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
  admin: { username: string; password: string; telegramId: string; timezone: string },
): Promise<void> {
  if ((await database.users.countDocuments({}, { limit: 1 })) > 0) return;

  await database.users.insertOne({
    username: admin.username,
    password: hashPassword(admin.password),
    isAdmin: true,
    timezone: admin.timezone,
    channelIdentities: [{ channel: "telegram", channelId: admin.telegramId }],
    createdAt: new Date(),
  });
}

/** Why an admin's change to Users was refused, in words the admin can act on. */
export class UserChangeError extends Error {}

/** Creates a User as an admin would; the password is kept only as a hash. Throws UserChangeError when refused. */
export async function createUser(
  database: Database,
  user: { username: string; password: string; isAdmin: boolean; timezone?: string },
): Promise<ObjectId> {
  if (!user.username) throw new UserChangeError("A User needs a username.");
  if (!user.password) throw new UserChangeError("A User needs a password.");
  if (user.timezone !== undefined) assertTimezone(user.timezone);
  try {
    const { insertedId } = await database.users.insertOne({
      username: user.username,
      password: hashPassword(user.password),
      isAdmin: user.isAdmin,
      ...(user.timezone !== undefined ? { timezone: user.timezone } : {}),
      channelIdentities: [],
      createdAt: new Date(),
    });
    return insertedId;
  } catch (error) {
    if (isDuplicateKeyError(error)) throw new UserChangeError(`The username "${user.username}" is taken.`);
    throw error;
  }
}

/**
 * Lets the sender with this Channel Identity use the bot as the User; adding one the User already has changes nothing.
 * Returns false when there is no such User. Throws UserChangeError when another User has it.
 */
export async function addChannelIdentity(database: Database, userId: ObjectId, identity: ChannelIdentity): Promise<boolean> {
  if (!identity.channel || !identity.channelId) throw new UserChangeError("A Channel Identity needs a Channel and an ID.");
  try {
    const { matchedCount } = await database.users.updateOne(
      { _id: userId },
      // Only the two fields, in this order, so equal identities are equal documents.
      { $addToSet: { channelIdentities: { channel: identity.channel, channelId: identity.channelId } } },
    );
    return matchedCount > 0;
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      throw new UserChangeError(`${identity.channel} ${identity.channelId} already belongs to another User.`);
    }
    throw error;
  }
}

/** Stops the sender with this Channel Identity using the bot as the User. Returns false when there is no such User. */
export async function removeChannelIdentity(database: Database, userId: ObjectId, identity: ChannelIdentity): Promise<boolean> {
  const { matchedCount } = await database.users.updateOne(
    { _id: userId },
    { $pull: { channelIdentities: { channel: identity.channel, channelId: identity.channelId } } },
  );
  return matchedCount > 0;
}

/** Replaces the User's password, so the old one stops working. Returns false when there is no such User. */
export async function resetPassword(database: Database, userId: ObjectId, password: string): Promise<boolean> {
  if (!password) throw new UserChangeError("A User needs a password.");
  const { matchedCount } = await database.users.updateOne({ _id: userId }, { $set: { password: hashPassword(password) } });
  return matchedCount > 0;
}

/** Sets the timezone the User's due dates are meant in; none means the configured default. Returns false when there is no such User. */
export async function setTimezone(database: Database, userId: ObjectId, timezone: string | undefined): Promise<boolean> {
  if (timezone !== undefined) assertTimezone(timezone);
  const { matchedCount } = await database.users.updateOne(
    { _id: userId },
    timezone === undefined ? { $unset: { timezone: "" } } : { $set: { timezone } },
  );
  return matchedCount > 0;
}

/**
 * Deletes the User, so they lose access to both the bot and the dashboard. Their Notes, Tasks and
 * Clarifications are kept; no Reminder goes out for a Task whose owner no longer exists.
 * Returns false when there is no such User.
 */
export async function deleteUser(database: Database, userId: ObjectId): Promise<boolean> {
  const { deletedCount } = await database.users.deleteOne({ _id: userId });
  return deletedCount > 0;
}

function assertTimezone(timezone: string): void {
  if (!isValidTimezone(timezone)) {
    throw new UserChangeError(`"${timezone}" is not an IANA timezone such as "Asia/Dubai".`);
  }
}
