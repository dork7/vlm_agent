import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import type { FastifyPluginAsync } from "fastify";
import type { LiveKitConfig } from "../voice/config.ts";
import { createVoiceToken } from "../voice/token.ts";
import { render } from "./http.ts";

/**
 * The browser build of the LiveKit client (its UMD bundle, which defines `LivekitClient`), served by this app
 * so the page needs no CDN. The package's `require` entry point is that bundle.
 */
const LIVEKIT_CLIENT = createRequire(import.meta.url).resolve("livekit-client");

/** The Voice page, where a logged-in User talks to the voice agent through LiveKit. */
export const voiceRoutes: FastifyPluginAsync<{ livekit: LiveKitConfig }> = async (app, { livekit }) => {
  let client: Buffer | undefined;

  app.get("/voice", async (_request, reply) => render(reply, "voice", {}));

  /** A fresh room and a token to join it; the voice agent is dispatched into the room when the User joins. */
  app.post("/voice/token", async (request, reply) => {
    reply.header("cache-control", "no-store");
    return createVoiceToken(livekit, request.user);
  });

  app.get("/voice/livekit-client.js", async (_request, reply) => {
    client ??= await readFile(LIVEKIT_CLIENT);
    return reply.type("text/javascript; charset=utf-8").header("cache-control", "private, max-age=3600").send(client);
  });
};
