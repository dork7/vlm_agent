import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { ObjectId } from "mongodb";
import { randomUUID } from "node:crypto";
import type { AssignContext } from "./context.ts";
import { hashPassword, randomToken, sha256, signJwt, verifyJwt, verifyPassword } from "./crypto.ts";
import { clearCookie, field, parseCookies, parseForm, render, setCookie } from "./http.ts";

export async function currentOwner(ctx: AssignContext, request: FastifyRequest, reply?: FastifyReply) {
  if (ctx.config.noLogin && request.url.startsWith("/assign")) return ctx.store.owners.findOneAndUpdate({ email: "local@task-assignment.test" }, { $setOnInsert: { email: "local@task-assignment.test", createdAt: ctx.now(), lastSeenEventId: 0 } }, { upsert: true, returnDocument: "after" });
  const cookies = parseCookies(request.headers.cookie);
  const token = cookies.ta_access;
  const refresh = cookies.ta_refresh;
  const refreshDoc = refresh ? await ctx.store.refreshTokens.findOne({ tokenHash: sha256(refresh) }) : null;
  if (refreshDoc?.rotatedAt && ctx.now().getTime() - refreshDoc.rotatedAt.getTime() > 30_000) {
    await ctx.store.refreshTokens.updateMany({ ownerId: refreshDoc.ownerId }, { $set: { revokedAt: ctx.now() } });
    return null;
  }
  const payload = token && verifyJwt(token, ctx.config.jwtSecret, ctx.now());
  if (payload && payload.sid && ObjectId.isValid(payload.sub)) {
    const ownerId = new ObjectId(payload.sub);
    const active = await ctx.store.refreshTokens.findOne({ ownerId, family: payload.sid, revokedAt: { $exists: false }, expiresAt: { $gt: ctx.now() } });
    if (active) return ctx.store.owners.findOne({ _id: ownerId });
  }
  if (!reply || !refresh) return null;
  const doc = refreshDoc;
  if (!doc || doc.revokedAt || doc.expiresAt <= ctx.now()) return null;
  const owner = await ctx.store.owners.findOne({ _id: doc.ownerId });
  if (!owner) return null;
  const next = randomToken();
  await ctx.store.refreshTokens.insertOne({ ownerId: owner._id, tokenHash: sha256(next), expiresAt: new Date(ctx.now().getTime() + 30 * 86_400_000), family: doc.family });
  if (!doc.rotatedAt) await ctx.store.refreshTokens.updateOne({ _id: doc._id, rotatedAt: { $exists: false } }, { $set: { rotatedAt: ctx.now() } });
  setCookie(reply, "ta_refresh", next, { path: "/assign", secure: ctx.config.secureCookies, maxAge: 30 * 86_400 });
  setAccess(ctx, reply, owner._id, doc.family);
  return owner;
}
function setAccess(ctx: AssignContext, reply: FastifyReply, ownerId: ObjectId, family: string) {
  setCookie(reply, "ta_access", signJwt({ sub: ownerId.toHexString(), sid: family, exp: Math.floor(ctx.now().getTime() / 1000) + 900 }, ctx.config.jwtSecret), { secure: ctx.config.secureCookies, maxAge: 900 });
}
export async function startSession(ctx: AssignContext, reply: FastifyReply, owner: { _id: ObjectId }) {
  const family = randomUUID();
  setAccess(ctx, reply, owner._id, family);
  const refresh = randomToken();
  await ctx.store.refreshTokens.insertOne({ ownerId: owner._id, tokenHash: sha256(refresh), family, expiresAt: new Date(ctx.now().getTime() + 30 * 86_400_000) });
  setCookie(reply, "ta_refresh", refresh, { path: "/assign", secure: ctx.config.secureCookies, maxAge: 30 * 86_400 });
}
export function requireOwner(ctx: AssignContext) { return async (request: FastifyRequest, reply: FastifyReply) => {
  if (!await currentOwner(ctx, request, reply)) return reply.code(302).header("location", "/assign/login").send();
}; }
const linkProblem = (reply: FastifyReply) => render(reply.code(400), "message", { title: "Link expired", message: "This login link expired or was already used. Login links work once and last 15 minutes.", href: "/assign/login", linkText: "Get a new login link" });
export function registerAuth(app: FastifyInstance, ctx: AssignContext) {
  if (ctx.config.noLogin) { app.get("/assign/login", async (_request, reply) => reply.code(303).header("location", "/assign").send()); return; }
  app.get("/assign/login", async (_request, reply) => render(reply, "login"));
  app.post("/assign/login", async (request, reply) => {
    const email = field(parseForm(request.body), "email").toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) return render(reply.code(400), "login", { error: "Enter a valid email address, like name@example.com.", email, mode: "link" });
    const allowed = ctx.limiter.allow(`email:${email}`, 5, 900_000) && ctx.limiter.allow(`ip:${request.ip}`, 5, 900_000);
    const accountAllowed = ctx.config.signupMode === "open" || ctx.config.allowedEmails.includes(email) || await ctx.store.owners.countDocuments({ email }) > 0;
    if (allowed && accountAllowed) {
      const token = randomToken();
      await ctx.store.loginTokens.insertOne({ email, tokenHash: sha256(token), expiresAt: new Date(ctx.now().getTime() + 900_000) });
      const link = `${ctx.config.publicUrl}/assign/auth?token=${token}`;
      await ctx.mailer.send({ to: email, subject: "Log in to Task assignment", text: `Log in: ${link}` });
    }
    return render(reply, "login-sent");
  });
  app.get("/assign/auth", async (request, reply) => {
    const token = (request.query as { token?: string }).token || "";
    return render(reply, "confirm-login", { token });
  });
  app.post("/assign/auth", async (request, reply) => {
    const token = field(parseForm(request.body), "token");
    const login = token && await ctx.store.loginTokens.findOneAndUpdate({ tokenHash: sha256(token), usedAt: { $exists: false }, expiresAt: { $gt: ctx.now() } }, { $set: { usedAt: ctx.now() } });
    if (!login) return linkProblem(reply);
    let owner = await ctx.store.owners.findOne({ email: login.email });
    if (!owner) {
      if (!ctx.limiter.allow(`signup:${request.ip}`, 5, 3_600_000)) return render(reply.code(429), "message", { title: "Too many attempts", message: "Too many new accounts from this network. Try again in an hour.", href: "/assign/login", linkText: "Back to log in" });
      if (ctx.config.signupMode === "allowlist" && !ctx.config.allowedEmails.includes(login.email)) return linkProblem(reply);
      try { const result = await ctx.store.owners.insertOne({ email: login.email, createdAt: ctx.now(), lastSeenEventId: 0 }); owner = await ctx.store.owners.findOne({ _id: result.insertedId }); }
      catch { owner = await ctx.store.owners.findOne({ email: login.email }); }
    }
    if (!owner) return render(reply.code(500), "message", { title: "Something went wrong", message: "We couldn't create your account. Please try again.", href: "/assign/login", linkText: "Back to log in" });
    await startSession(ctx, reply, owner);
    return reply.code(303).header("location", owner.offeredPassword ? "/assign" : "/assign/password-offer").send();
  });
  app.get("/assign/password-offer", { preHandler: requireOwner(ctx) }, async (_request, reply) => render(reply, "password-offer"));
  app.post("/assign/password-offer", { preHandler: requireOwner(ctx) }, async (request, reply) => {
    const owner = await currentOwner(ctx, request, reply); if (!owner) return;
    const form = parseForm(request.body);
    const password = field(form, "skip") === "1" ? "" : field(form, "password");
    if (password && password.length < 10) return render(reply.code(400), "password-offer", { error: "Password needs at least 10 characters. Choose a longer one, or skip for now." });
    await ctx.store.owners.updateOne({ _id: owner._id }, { $set: { offeredPassword: true, ...(password ? { passwordHash: hashPassword(password) } : {}) } });
    return reply.code(303).header("location", "/assign").send();
  });
  app.post("/assign/password-login", async (request, reply) => {
    const form = parseForm(request.body), email = field(form, "email").toLowerCase(), password = field(form, "password");
    const wrong = { error: "That email and password don't match. Check them, or log in with an email link instead.", email, mode: "password" };
    if (!ctx.limiter.allow(`password:${email}`, 5, 900_000)) return render(reply.code(429), "login", wrong);
    const owner = await ctx.store.owners.findOne({ email });
    if (!owner?.passwordHash || !verifyPassword(password, owner.passwordHash)) return render(reply.code(400), "login", wrong);
    await startSession(ctx, reply, owner); return reply.code(303).header("location", "/assign").send();
  });
  app.get("/assign/settings", { preHandler: requireOwner(ctx) }, async (request, reply) => render(reply, "settings", { saved: (request.query as { saved?: string }).saved === "1" }));
  app.post("/assign/settings/password", { preHandler: requireOwner(ctx) }, async (request, reply) => {
    const owner = await currentOwner(ctx, request, reply); if (!owner) return;
    const password = field(parseForm(request.body), "password"); if (password.length < 10) return render(reply.code(400), "settings", { error: "Password needs at least 10 characters." });
    await ctx.store.owners.updateOne({ _id: owner._id }, { $set: { passwordHash: hashPassword(password), offeredPassword: true } });
    await ctx.store.refreshTokens.updateMany({ ownerId: owner._id }, { $set: { revokedAt: ctx.now() } });
    await startSession(ctx, reply, owner); return reply.code(303).header("location", "/assign/settings?saved=1").send();
  });
  app.post("/assign/logout", async (request, reply) => {
    const hash = sha256(parseCookies(request.headers.cookie).ta_refresh || "");
    const token = await ctx.store.refreshTokens.findOne({ tokenHash: hash });
    if (token) await ctx.store.refreshTokens.updateMany({ ownerId: token.ownerId, family: token.family }, { $set: { revokedAt: ctx.now() } });
    clearCookie(reply, "ta_access"); clearCookie(reply, "ta_refresh", "/assign"); return reply.code(303).header("location", "/assign/login").send();
  });
  app.post("/assign/logout-all", { preHandler: requireOwner(ctx) }, async (request, reply) => {
    const owner = await currentOwner(ctx, request, reply); if (!owner) return;
    await ctx.store.refreshTokens.updateMany({ ownerId: owner._id }, { $set: { revokedAt: ctx.now() } });
    clearCookie(reply, "ta_access"); clearCookie(reply, "ta_refresh", "/assign"); return reply.code(303).header("location", "/assign/login").send();
  });
}
