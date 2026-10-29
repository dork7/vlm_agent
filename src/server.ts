import Fastify, { type FastifyInstance } from "fastify";

export function buildServer(): FastifyInstance {
  const server = Fastify({ logger: true });
  server.get("/health", async () => ({ status: "ok" }));
  return server;
}
