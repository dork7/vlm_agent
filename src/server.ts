import Fastify, { type FastifyInstance } from "fastify";
import { inventoryRoutes, type InventoryApiOptions } from "./inventory/api.ts";

export function buildServer(options: { logger?: boolean; inventory: InventoryApiOptions }): FastifyInstance {
  const server = Fastify({ logger: options.logger ?? true });
  server.get("/health", async () => ({ status: "ok" }));
  server.register(inventoryRoutes, { prefix: "/inventory", ...options.inventory });
  return server;
}
