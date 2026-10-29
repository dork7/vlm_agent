import Fastify, { type FastifyInstance, type RouteHandlerMethod } from "fastify";
import { inventoryRoutes, type InventoryApiOptions } from "./inventory/api.ts";

export function buildServer(options: {
  logger?: boolean;
  inventory: InventoryApiOptions;
  /** Present in webhook mode: the route a Channel posts its updates to. */
  webhook?: { path: string; handler: RouteHandlerMethod };
}): FastifyInstance {
  const server = Fastify({ logger: options.logger ?? true });
  server.get("/health", async () => ({ status: "ok" }));
  server.register(inventoryRoutes, { prefix: "/inventory", ...options.inventory });
  if (options.webhook) server.post(options.webhook.path, options.webhook.handler);
  return server;
}
