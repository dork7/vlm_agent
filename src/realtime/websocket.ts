import type { FastifyInstance } from "fastify";
import { writeFile } from "node:fs/promises";
import { ObjectId } from "mongodb";
import fp from "fastify-plugin";
import websocket, { type WebSocket } from "@fastify/websocket";
import { createRealtimeAgent } from "./agent.ts";

/** One client's live voice session. */
type ClientSession = {
  socket: WebSocket;
  /** Audio chunks the client has sent since we last processed them. */
  chunks: Buffer[];
  /** Idle timer: reset on every chunk; when it fires, we process what we have. */
  idleTimer: NodeJS.Timeout | null;
};

/** How long of silence (no chunks) before we treat the person as done speaking. */
const IDLE_MS = 1_200;

/** Synthetic owner for the web agent: every web user shares one "web" user. */
const WEB_OWNER_ID = new ObjectId("000000000000000000000000");

export type RealtimeOptions = {
  database: Parameters<typeof createRealtimeAgent>[0]["database"];
  llm: Parameters<typeof createRealtimeAgent>[0]["llm"];
  inventory: Parameters<typeof createRealtimeAgent>[0]["inventory"];
  transcriber: Parameters<typeof createRealtimeAgent>[0]["transcriber"];
  tts: Parameters<typeof createRealtimeAgent>[0]["tts"];
  defaultTimezone: string;
  /** The WebSocket path the browser connects to; the page itself is the dashboard's `GET /realtime`. */
  path?: string;
};

/** Mounts the realtime talking agent's WebSocket on `GET <path>`. */
export const realtimePlugin = fp<RealtimeOptions>(async (app, options) => {
  const { path = "/realtime/ws", ...agentDeps } = options;
  await app.register(websocket);
  const agent = createRealtimeAgent({
    ...agentDeps,
    now: () => new Date(),
  });

  /** Sessions keyed by socket, so each tab/conversation keeps its own audio buffer. */
  const sessions = new WeakMap<WebSocket, ClientSession>();

  const sessionOf = (socket: WebSocket): ClientSession => {
    let session = sessions.get(socket);
    if (!session) {
      session = { socket, chunks: [], idleTimer: null };
      sessions.set(socket, session);
    }
    return session;
  };

  const clearIdle = (session: ClientSession) => {
    if (session.idleTimer) {
      clearTimeout(session.idleTimer);
      session.idleTimer = null;
    }
  };

  const processSession = async (session: ClientSession) => {
    clearIdle(session);
    const audio = Buffer.concat(session.chunks);
    session.chunks = [];
    if (audio.length === 0) return;

    // A rough duration estimate so the Run record isn't completely blank.
    const durationSeconds = Math.max(1, Math.round(audio.length / 16_000));

    await agent.handleAudio(
      {
        durationSeconds,
        async download(toPath: string) {
          await writeFile(toPath, audio);
        },
      },
      async (event) => {
        switch (event.type) {
          case "transcript":
          case "response":
          case "error": {
            const text = (event as { message?: string; text?: string }).text ?? (event as { message?: string }).message;
            if (text === undefined) return;
            session.socket.send(JSON.stringify({ type: event.type, text }));
            break;
          }
          case "audio": {
            session.socket.send(event.audio, { binary: true });
            break;
          }
        }
      },
      WEB_OWNER_ID,
    );
  };

  app.get(path, { websocket: true }, (socket, _request) => {
    socket.on("message", (data, isBinary) => {
      const session = sessionOf(socket);
      clearIdle(session);
      const message = Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data as ArrayBuffer);

      if (!isBinary) {
        if (message.toString("utf8").trim() === "end") {
          // The person finished speaking; process what we have.
          void processSession(session).catch((error) => app.log.error(error, "Realtime voice turn failed"));
        }
        return;
      }

      // Binary frame: more recorded audio.
      session.chunks.push(message);
      session.idleTimer = setTimeout(
        () => void processSession(session).catch((error) => app.log.error(error, "Realtime voice turn failed")),
        IDLE_MS,
      );
    });

    socket.on("close", () => {
      clearIdle(sessionOf(socket));
      sessions.delete(socket);
    });

    socket.on("error", () => {
      clearIdle(sessionOf(socket));
      sessions.delete(socket);
    });
  });

  app.log.info(`Realtime talking agent listening at ${path}`);
});
