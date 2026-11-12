import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { Llm } from "../src/llm/openrouter.ts";
import type { Tts } from "../src/realtime/tts.ts";
import { buildServer } from "../src/server.ts";
import { hashPassword } from "../src/users.ts";
import { useMemoryMongo } from "./fakes/memory-mongo.ts";
import { unusedInventory } from "./fakes/unused.ts";

function basicAuth(username: string, password: string) {
  return { authorization: `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}` };
}

describe("realtime talking agent", () => {
  const database = useMemoryMongo();
  let server: FastifyInstance;
  const heard: Buffer[] = [];

  beforeAll(async () => {
    server = buildServer({
      logger: false,
      inventory: { items: [], apiKey: "unused" },
      dashboard: { database: database(), defaultTimezone: "UTC" },
      realtime: {
        database: database(),
        llm: {} as Llm,
        inventory: unusedInventory,
        transcriber: {
          model: "fake",
          async transcribe(audio) {
            const dir = await mkdtemp(join(tmpdir(), "realtime-test-"));
            try {
              await audio.download(join(dir, "audio"));
              heard.push(await readFile(join(dir, "audio")));
            } finally {
              await rm(dir, { recursive: true, force: true });
            }
            throw new Error("could not transcribe");
          },
        },
        tts: {} as Tts,
        defaultTimezone: "UTC",
      },
    });
    await server.ready();
    await database().users.insertOne({
      username: "ana",
      password: hashPassword("secret"),
      isAdmin: false,
      channelIdentities: [],
      createdAt: new Date(),
    });
  });
  afterAll(() => server.close());

  it("serves the Talk page inside the dashboard, linked from the nav", async () => {
    const page = await server.inject({ method: "GET", url: "/realtime", headers: basicAuth("ana", "secret") });
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain('<a href="/realtime">Talk</a>');
    expect(page.body).toContain('"/realtime/ws"');
  });

  it("sends the recorded audio to the agent when the client says it's done, and relays the agent's reply", async () => {
    const socket = await server.injectWS("/realtime/ws");
    const reply = new Promise<{ type: string; text: string }>((resolve) =>
      socket.once("message", (data) => resolve(JSON.parse(data.toString()))),
    );
    socket.send(Buffer.from("fake audio"));
    socket.send("end");

    expect(await reply).toEqual({ type: "error", text: "I didn't catch that. Could you say it again?" });
    expect(heard.at(-1)?.toString()).toBe("fake audio");
    socket.terminate();
  });
});
