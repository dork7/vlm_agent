import ejs from "ejs";
import { fileURLToPath } from "node:url";
import type { FastifyReply } from "fastify";
import { ObjectId } from "mongodb";
const views = fileURLToPath(new URL("./views/", import.meta.url));
export type Form = Record<string, unknown> | undefined;
export const field = (form: Form, name: string) => typeof form?.[name] === "string" ? (form[name] as string).trim() : "";
export const fields = (form: Form, name: string) => { const value = form?.[name]; return Array.isArray(value) ? value.filter((x): x is string => typeof x === "string") : typeof value === "string" ? [value] : []; };
export const parseForm = (body: unknown): Form => body && typeof body === "object" && !Array.isArray(body) ? body as Form : undefined;
export function parseCookies(header?: string) { return Object.fromEntries((header || "").split(";").map(x => x.trim().split("=", 2)).filter(x => x.length === 2)); }
export function setCookie(reply: FastifyReply, name: string, value: string, options: { path?: string; secure?: boolean; maxAge?: number } = {}) {
  const cookie = `${name}=${value}; Path=${options.path || "/"}; HttpOnly; SameSite=Lax${options.secure ? "; Secure" : ""}${options.maxAge === undefined ? "" : `; Max-Age=${options.maxAge}`}`;
  const prior = reply.getHeader("set-cookie"); reply.header("set-cookie", [...(Array.isArray(prior) ? prior : prior ? [String(prior)] : []), cookie]);
}
export function clearCookie(reply: FastifyReply, name: string, path = "/") { setCookie(reply, name, "", { path, maxAge: 0 }); }
export const parseId = (value: string) => /^[a-f\d]{24}$/i.test(value) ? new ObjectId(value) : null;
export async function render(reply: FastifyReply, view: string, data: Record<string, unknown> = {}) {
  return reply.type("text/html; charset=utf-8").send(await ejs.renderFile(`${views}${view}.ejs`, data));
}
