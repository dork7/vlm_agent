import type { Database, UserDoc } from "../db.ts";
import { hashPassword, verifyPassword } from "../users.ts";

/** Checked when no User has the username, so a wrong username takes as long as a wrong password. */
const DECOY = { password: hashPassword("no user has this password") };

/** The User named by an HTTP basic auth header, if the password matches. */
export async function authenticate(database: Database, header: string | undefined): Promise<UserDoc | null> {
  const credentials = parseBasicAuth(header);
  if (!credentials) return null;
  const user = await database.users.findOne({ username: credentials.username });
  const matches = verifyPassword(user ?? DECOY, credentials.password);
  return user && matches ? user : null;
}

function parseBasicAuth(header: string | undefined): { username: string; password: string } | null {
  const match = /^Basic\s+(\S+)$/i.exec(header ?? "");
  if (!match) return null;
  const decoded = Buffer.from(match[1]!, "base64").toString("utf8");
  const colon = decoded.indexOf(":");
  if (colon < 0) return null;
  return { username: decoded.slice(0, colon), password: decoded.slice(colon + 1) };
}
