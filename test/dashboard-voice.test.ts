import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { ObjectId } from "mongodb";
import { TokenVerifier } from "livekit-server-sdk";
import { buildServer } from "../src/server.ts";
import { hashPassword } from "../src/users.ts";
import { VOICE_AGENT_NAME } from "../src/voice/config.ts";
import { useMemoryMongo } from "./fakes/memory-mongo.ts";

const LIVEKIT = { url: "ws://localhost:7880", apiKey: "devkey", apiSecret: "a-long-enough-test-secret-for-hs256" };

function basicAuth(username: string, password: string) {
  return { authorization: `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}` };
}

describe("dashboard Voice page", () => {
  const database = useMemoryMongo();
  let withVoice: FastifyInstance;
  let withoutVoice: FastifyInstance;
  let aliceId: ObjectId;

  beforeAll(async () => {
    const options = { logger: false, inventory: { items: [], apiKey: "unused" } };
    withVoice = buildServer({ ...options, dashboard: { database: database(), defaultTimezone: "UTC", voice: LIVEKIT } });
    withoutVoice = buildServer({ ...options, dashboard: { database: database(), defaultTimezone: "UTC" } });
    await Promise.all([withVoice.ready(), withoutVoice.ready()]);
  });
  afterAll(() => Promise.all([withVoice.close(), withoutVoice.close()]));

  beforeEach(async () => {
    ({ insertedId: aliceId } = await database().users.insertOne({
      username: "alice",
      password: hashPassword("alice-pass"),
      isAdmin: false,
      channelIdentities: [],
      createdAt: new Date(),
    }));
  });

  const as = basicAuth("alice", "alice-pass");

  it("shows the Voice page, linked from the nav, to a logged-in User", async () => {
    const page = await withVoice.inject({ method: "GET", url: "/voice", headers: as });

    expect(page.statusCode).toBe(200);
    expect(page.body).toContain("<h1>Voice</h1>");
    expect(page.body).toContain('<script src="/voice/livekit-client.js"></script>');
    expect(page.body).toContain('<a href="/voice">Voice</a>');

    const tasks = await withVoice.inject({ method: "GET", url: "/tasks", headers: as });
    expect(tasks.body).toContain('<a href="/voice">Voice</a>');
  });

  it("asks for credentials before the page or a token", async () => {
    for (const [method, url] of [["GET", "/voice"], ["POST", "/voice/token"], ["GET", "/voice/livekit-client.js"]] as const) {
      const response = await withVoice.inject({ method, url });
      expect(response.statusCode, `${method} ${url}`).toBe(401);
    }
  });

  it("gives a token to join a new room of the User's own, into which the voice agent is dispatched", async () => {
    const response = await withVoice.inject({ method: "POST", url: "/voice/token", headers: as });

    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    const { url, token, room } = response.json();
    expect(url).toBe(LIVEKIT.url);
    expect(room).toMatch(new RegExp(`^voice-${aliceId.toHexString()}-[0-9a-f]{8}$`));

    const claims = await new TokenVerifier(LIVEKIT.apiKey, LIVEKIT.apiSecret).verify(token);
    expect(claims.sub).toBe(`user-${aliceId.toHexString()}`);
    expect(claims.name).toBe("alice");
    expect(claims.video).toMatchObject({ room, roomJoin: true, canPublish: true, canSubscribe: true });
    expect(claims.video?.roomAdmin).toBeFalsy();
    expect(claims.roomConfig?.agents.map((agent) => agent.agentName)).toEqual([VOICE_AGENT_NAME]);
    // Short-lived: it is only for joining.
    expect(claims.exp! - Date.now() / 1000).toBeLessThanOrEqual(10 * 60);
  });

  it("starts a different room for each conversation", async () => {
    const rooms = new Set<string>();
    for (let i = 0; i < 3; i++) {
      rooms.add((await withVoice.inject({ method: "POST", url: "/voice/token", headers: as })).json().room);
    }
    expect(rooms.size).toBe(3);
  });

  it("serves the LiveKit browser client itself", async () => {
    const response = await withVoice.inject({ method: "GET", url: "/voice/livekit-client.js", headers: as });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toBe("text/javascript; charset=utf-8");
    expect(response.body).toContain("LivekitClient");
  });

  it("has no Voice page when no LiveKit server is configured", async () => {
    for (const [method, url] of [["GET", "/voice"], ["POST", "/voice/token"]] as const) {
      expect((await withoutVoice.inject({ method, url, headers: as })).statusCode).toBe(404);
    }
    const tasks = await withoutVoice.inject({ method: "GET", url: "/tasks", headers: as });
    expect(tasks.body).not.toContain('href="/voice"');
  });
});
