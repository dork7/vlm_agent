import type { Db } from "mongodb";
import type { FastifyPluginAsync } from "fastify";
import type { AssignConfig } from "./config.ts";
import type { Mailer } from "./mailer.ts";
import { openAssignStore } from "./store.ts";
import { createRateLimiter } from "./rate-limit.ts";
import { registerAuth } from "./auth.ts";
import { registerWorkflow } from "./workflow.ts";
import { registerSse } from "./sse.ts";
import { purgeOld } from "./housekeeping.ts";
import { randomToken } from "./crypto.ts";
import { parseCookies, setCookie } from "./http.ts";
export type AssignOptions = { db: Db; config: AssignConfig; mailer: Mailer; now?: () => Date };
export const assignRoutes: FastifyPluginAsync<AssignOptions> = async (app, options) => {
  app.addHook("onRoute", route => { if (route.url.startsWith("/l/") || route.url === "/assign/auth") route.logLevel = "silent"; });
  app.addContentTypeParser("application/x-www-form-urlencoded", { parseAs: "string" }, (_request, body, done) => {
    const form: Record<string, string | string[]> = {};
    for (const [key, value] of new URLSearchParams(String(body))) {
      const old = form[key]; form[key] = old === undefined ? value : [...(Array.isArray(old) ? old : [old]), value];
    }
    done(null, form);
  });
  const now = options.now || (() => new Date());
  const ctx = { store: await openAssignStore(options.db), config: options.config, mailer: options.mailer, now, limiter: createRateLimiter(now) };
  const csrf = new WeakMap<object, string>();
  app.addHook("onRequest", async (request, reply) => {
    if (request.url.startsWith("/l/") && !ctx.limiter.allow(`link:${request.ip}`, 60, 60_000)) return reply.code(429).send("Try again later.");
    if (!request.url.startsWith("/assign")) return;
    const cookies = parseCookies(request.headers.cookie);
    const token = cookies.ta_csrf || randomToken(24);
    csrf.set(request, token);
    if (!cookies.ta_csrf) setCookie(reply, "ta_csrf", token, { path: "/assign", secure: options.config.secureCookies, maxAge: 30 * 86_400 });
  });
  app.addHook("preHandler", async (request, reply) => {
    if (!request.url.startsWith("/assign") || ["GET", "HEAD", "OPTIONS"].includes(request.method)) return;
    const cookie = parseCookies(request.headers.cookie).ta_csrf;
    const form = request.body && typeof request.body === "object" ? request.body as Record<string, unknown> : {};
    const submitted = request.headers["x-csrf-token"] || form.csrf;
    if (!cookie || submitted !== cookie) return reply.code(403).send("Invalid CSRF token.");
  });
  app.addHook("onSend", async (request, reply, payload) => {
    if (!request.url.startsWith("/assign") || typeof payload !== "string" || !String(reply.getHeader("content-type") || "").includes("text/html")) return payload;
    const token = csrf.get(request);
    return token ? payload.replace(/(<form\b[^>]*method="post"[^>]*>)/gi, `$1<input type="hidden" name="csrf" value="${token}">`) : payload;
  });
  registerAuth(app, ctx);
  registerWorkflow(app, ctx);
  registerSse(app, ctx);
  void purgeOld(ctx).catch(error => app.log.error(error, "Task assignment purge failed"));
  const timer = setInterval(() => { void purgeOld(ctx).catch(error => app.log.error(error, "Task assignment purge failed")); }, 86_400_000);
  timer.unref();
  app.addHook("onClose", async () => clearInterval(timer));
};
