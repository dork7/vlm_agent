import { argon2Sync, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const randomToken = (bytes = 32) => randomBytes(bytes).toString("base64url");
export const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");
const encode = (x: unknown) => Buffer.from(JSON.stringify(x)).toString("base64url");
export function signJwt(payload: { sub: string; exp: number; sid?: string }, secret: string): string {
  const body = `${encode({ alg: "HS256", typ: "JWT" })}.${encode(payload)}`;
  return `${body}.${createHmac("sha256", secret).update(body).digest("base64url")}`;
}
export function verifyJwt(token: string, secret: string, now: Date): { sub: string; exp: number; sid?: string } | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const expected = createHmac("sha256", secret).update(`${parts[0]}.${parts[1]}`).digest();
  let received: Buffer;
  try { received = Buffer.from(parts[2]!, "base64url"); } catch { return null; }
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) return null;
  try {
    const data: unknown = JSON.parse(Buffer.from(parts[1]!, "base64url").toString());
    if (!data || typeof data !== "object") return null;
    const p = data as Record<string, unknown>;
    return typeof p.sub === "string" && typeof p.exp === "number" && p.exp > now.getTime() / 1000
      ? { sub: p.sub, exp: p.exp, ...(typeof p.sid === "string" ? { sid: p.sid } : {}) } : null;
  } catch { return null; }
}
export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const key = argon2Sync("argon2id", { message: password, nonce: salt, parallelism: 1, tagLength: 32, memory: 19456, passes: 2 });
  return `argon2id:${salt.toString("base64url")}:${key.toString("base64url")}`;
}
export function verifyPassword(password: string, stored: string): boolean {
  const [algorithm, encodedSalt, encodedKey] = stored.split(":");
  if (algorithm !== "argon2id" || !encodedSalt || !encodedKey) return false;
  const key = Buffer.from(encodedKey, "base64url");
  const actual = argon2Sync("argon2id", { message: password, nonce: Buffer.from(encodedSalt, "base64url"), parallelism: 1, tagLength: key.length, memory: 19456, passes: 2 });
  return timingSafeEqual(key, actual);
}
