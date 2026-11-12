import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { ObjectId } from "mongodb";
import { randomUUID } from "node:crypto";
import type { AssignContext } from "./context.ts";
import { hashPassword, randomToken, sha256, signJwt, verifyJwt, verifyPassword } from "./crypto.ts";
import { clearCookie, field, parseCookies, parseForm, render, setCookie } from "./http.ts";

export async function currentOwner(ctx: AssignContext, request: FastifyRequest, reply?: FastifyReply) {
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
export function registerAuth(app: FastifyInstance, ctx: AssignContext) {
  app.get("/assign/login", async (_request, reply) => render(reply, "login"));
  app.post("/assign/login", async (request, reply) => {
    const email = field(parseForm(request.body), "email").toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) return reply.code(400).send("Enter a valid email.");
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
    if (!login) return reply.code(400).send("This link expired or was already used.");
    let owner = await ctx.store.owners.findOne({ email: login.email });
    if (!owner) {
      if (!ctx.limiter.allow(`signup:${request.ip}`, 5, 3_600_000)) return reply.code(429).send("Try again later.");
      if (ctx.config.signupMode === "allowlist" && !ctx.config.allowedEmails.includes(login.email)) return reply.code(400).send("This link expired or was already used.");
      try { const result = await ctx.store.owners.insertOne({ email: login.email, createdAt: ctx.now(), lastSeenEventId: 0 }); owner = await ctx.store.owners.findOne({ _id: result.insertedId }); }
      catch { owner = await ctx.store.owners.findOne({ email: login.email }); }
    }
    if (!owner) return reply.code(500).send("Could not create account.");
    await startSession(ctx, reply, owner);
    return reply.code(303).header("location", owner.offeredPassword ? "/assign" : "/assign/password-offer").send();
  });
  app.get("/assign/password-offer", { preHandler: requireOwner(ctx) }, async (_request, reply) => render(reply, "password-offer"));
  app.post("/assign/password-offer", { preHandler: requireOwner(ctx) }, async (request, reply) => {
    const owner = await currentOwner(ctx, request, reply); if (!owner) return;
    const password = field(parseForm(request.body), "password");
    if (password && password.length < 10) return reply.code(400).send("Password needs at least 10 characters.");
    await ctx.store.owners.updateOne({ _id: owner._id }, { $set: { offeredPassword: true, ...(password ? { passwordHash: hashPassword(password) } : {}) } });
    return reply.code(303).header("location", "/assign").send();
  });
  app.post("/assign/password-login", async (request, reply) => {
    const form = parseForm(request.body), email = field(form, "email").toLowerCase(), password = field(form, "password");
    if (!ctx.limiter.allow(`password:${email}`, 5, 900_000)) return reply.code(429).send("Invalid email or password.");
    const owner = await ctx.store.owners.findOne({ email });
    if (!owner?.passwordHash || !verifyPassword(password, owner.passwordHash)) return reply.code(400).send("Invalid email or password.");
    await startSession(ctx, reply, owner); return reply.code(303).header("location", "/assign").send();
  });
  app.get("/assign/settings", { preHandler: requireOwner(ctx) }, async (_request, reply) => render(reply, "settings"));
  app.post("/assign/settings/password", { preHandler: requireOwner(ctx) }, async (request, reply) => {
    const owner = await currentOwner(ctx, request, reply); if (!owner) return;
    const password = field(parseForm(request.body), "password"); if (password.length < 10) return reply.code(400).send("Password needs at least 10 characters.");
    await ctx.store.owners.updateOne({ _id: owner._id }, { $set: { passwordHash: hashPassword(password), offeredPassword: true } });
    await ctx.store.refreshTokens.updateMany({ ownerId: owner._id }, { $set: { revokedAt: ctx.now() } });
    await startSession(ctx, reply, owner); return reply.code(303).header("location", "/assign/settings").send();
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
