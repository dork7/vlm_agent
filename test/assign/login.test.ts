import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import Fastify from "fastify";
import { MongoClient } from "mongodb";
import { MongoMemoryServer } from "mongodb-memory-server";
import { assignRoutes } from "../../src/assign/index.ts";
import type { Mail } from "../../src/assign/mailer.ts";
import { loadAssignConfig } from "../../src/assign/config.ts";

describe("Task assignment login", () => {
  let mongo: MongoMemoryServer;
  let client: MongoClient;
  let app: ReturnType<typeof Fastify>;
  let now: Date;
  const mail: Mail[] = [];
  const config = loadAssignConfig({ PUBLIC_URL: "http://assign.test", ASSIGN_JWT_SECRET: "x".repeat(32) })!;
  beforeAll(async () => { mongo = await MongoMemoryServer.create(); client = await MongoClient.connect(mongo.getUri()); });
  beforeEach(async () => {
    now = new Date("2026-11-12T09:00:00Z"); mail.length = 0;
    app = Fastify({ logger: false });
    await app.register(assignRoutes, { db: client.db(`assign_${crypto.randomUUID()}`), config, mailer: { send: async (m: Mail) => { mail.push(m); } }, now: () => now });
    await app.ready();
  });
  afterEach(async () => { await app.close(); });
  afterAll(async () => { await client?.close(); await mongo?.stop(); });
  const post = async (url: string, form: Record<string, string>, cookie = "") => {
    const initial = await app.inject({ method: "GET", url: "/assign/login" });
    const csrf = (initial.headers["set-cookie"] as string[]).find(x => x.startsWith("ta_csrf="))!.split(";")[0]!;
    const token = csrf.slice("ta_csrf=".length);
    return app.inject({ method: "POST", url, headers: { "content-type": "application/x-www-form-urlencoded", cookie: `${csrf}${cookie ? `; ${cookie}` : ""}` }, payload: new URLSearchParams({ ...form, csrf: token }).toString() });
  };
  it("keeps a preview GET harmless and accepts the token once", async () => {
    await post("/assign/login", { email: "Sara@Example.com" });
    expect(mail).toHaveLength(1);
    expect(mail[0]!.to).toBe("sara@example.com");
    const link = mail[0]!.text.match(/http:\/\/\S+/)![0]!;
    const path = new URL(link).pathname + new URL(link).search;
    expect((await app.inject({ method: "GET", url: path })).body).toContain("Log in");
    expect((await app.inject({ method: "GET", url: path })).body).toContain("Log in");
    const token = new URL(link).searchParams.get("token")!;
    const login = await post("/assign/auth", { token });
    expect(login.statusCode).toBe(303);
    const access = (login.headers["set-cookie"] as string[]).find(x => x.startsWith("ta_access="))!.split(";")[0]!;
    expect((await app.inject({ method: "GET", url: "/assign", headers: { cookie: access } })).statusCode).toBe(200);
    expect((await post("/assign/auth", { token })).statusCode).toBe(400);
  });
  it("expires links and gives the same response under rate limits", async () => {
    const first = await post("/assign/login", { email: "one@example.com" });
    for (let i = 0; i < 6; i++) expect((await post("/assign/login", { email: "one@example.com" })).body).toBe(first.body);
    expect(mail).toHaveLength(5);
    const token = new URL(mail[0]!.text.match(/http:\/\/\S+/)![0]!).searchParams.get("token")!;
    now = new Date(now.getTime() + 900_001);
    expect((await post("/assign/auth", { token })).statusCode).toBe(400);
  });
  it("renews parallel requests and revokes a reused rotated token after grace", async () => {
    await post("/assign/login", { email: "owner@example.com" });
    const token = new URL(mail[0]!.text.match(/http:\/\/\S+/)![0]!).searchParams.get("token")!;
    const login = await post("/assign/auth", { token });
    const cookies = (login.headers["set-cookie"] as string[]).map(x => x.split(";")[0]!).filter(x => x.startsWith("ta_access=") || x.startsWith("ta_refresh=")).join("; ");
    await post("/assign/login", { email: "owner@example.com" });
    const secondToken = new URL(mail.at(-1)!.text.match(/http:\/\/\S+/)![0]!).searchParams.get("token")!;
    const secondLogin = await post("/assign/auth", { token: secondToken });
    const secondCookies = (secondLogin.headers["set-cookie"] as string[]).map(x => x.split(";")[0]!).filter(x => x.startsWith("ta_access=") || x.startsWith("ta_refresh=")).join("; ");
    now = new Date(now.getTime() + 901_000);
    const [one, two] = await Promise.all([app.inject({ method: "GET", url: "/assign", headers: { cookie: cookies } }), app.inject({ method: "GET", url: "/assign", headers: { cookie: cookies } })]);
    expect(one.statusCode).toBe(200); expect(two.statusCode).toBe(200);
    const replacement = (one.headers["set-cookie"] as string[]).find(x => x.startsWith("ta_refresh="))!.split(";")[0]!;
    now = new Date(now.getTime() + 31_000);
    expect((await app.inject({ method: "GET", url: "/assign", headers: { cookie: cookies } })).statusCode).toBe(302);
    expect((await app.inject({ method: "GET", url: "/assign", headers: { cookie: replacement } })).statusCode).toBe(302);
    expect((await app.inject({ method: "GET", url: "/assign", headers: { cookie: secondCookies } })).statusCode).toBe(302);
  });
  it("offers a password, rate-limits guesses, and signs out everywhere", async () => {
    await post("/assign/login", { email: "owner@example.com" });
    const token = new URL(mail[0]!.text.match(/http:\/\/\S+/)![0]!).searchParams.get("token")!;
    const login = await post("/assign/auth", { token });
    const cookies = (login.headers["set-cookie"] as string[]).map(x => x.split(";")[0]!).filter(x => x.startsWith("ta_access=") || x.startsWith("ta_refresh=")).join("; ");
    expect(login.headers.location).toBe("/assign/password-offer");
    expect((await post("/assign/password-offer", { password: "short" }, cookies)).statusCode).toBe(400);
    expect((await post("/assign/password-offer", { password: "long-password" }, cookies)).statusCode).toBe(303);
    for (let i = 0; i < 5; i++) expect((await post("/assign/password-login", { email: "owner@example.com", password: "wrong" })).statusCode).toBe(400);
    expect((await post("/assign/password-login", { email: "owner@example.com", password: "wrong" })).statusCode).toBe(429);
    expect((await post("/assign/logout-all", {}, cookies)).statusCode).toBe(303);
    expect((await app.inject({ method: "GET", url: "/assign", headers: { cookie: cookies } })).statusCode).toBe(302);
  });
  it("keeps allowlist responses uniform and emails only allowed addresses", async () => {
    const sent: Mail[] = [];
    const restricted = Fastify({ logger: false });
    await restricted.register(assignRoutes, { db: client.db(`allow_${crypto.randomUUID()}`), config: { ...config, signupMode: "allowlist", allowedEmails: ["allowed@example.com"] }, mailer: { send: async (message: Mail) => { sent.push(message); } } });
    await restricted.ready();
    const csrfReply = await restricted.inject("/assign/login");
    const csrf = (csrfReply.headers["set-cookie"] as string[]).find(x => x.startsWith("ta_csrf="))!.split(";")[0]!;
    const request = (email: string) => restricted.inject({ method: "POST", url: "/assign/login", headers: { cookie: csrf, "content-type": "application/x-www-form-urlencoded" }, payload: new URLSearchParams({ email, csrf: csrf.slice(8) }).toString() });
    const allowed = await request("allowed@example.com"), denied = await request("denied@example.com");
    expect(allowed.statusCode).toBe(denied.statusCode);
    expect(allowed.body).toBe(denied.body);
    expect(sent.map(x => x.to)).toEqual(["allowed@example.com"]);
    await restricted.close();
  });
  it("offers system and manual appearance controls on auth and link pages", async () => {
    const login = await app.inject("/assign/login");
    const unavailable = await app.inject("/l/AbCd123456");
    for (const response of [login, unavailable]) {
      expect(response.body).toContain("prefers-color-scheme: light");
      expect(response.body).toContain("Appearance:");
      expect(response.body).toContain("aria-live");
      expect(response.body).toContain("--surface-1");
    }
    expect(unavailable.headers["x-robots-tag"]).toBe("noindex");
  });
});
