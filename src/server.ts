import Fastify, { type FastifyInstance, type RouteHandlerMethod } from "fastify";
import { dashboardRoutes, type DashboardOptions } from "./dashboard/dashboard.ts";
import { inventoryRoutes, type InventoryApiOptions } from "./inventory/api.ts";

export function buildServer(options: {
  logger?: boolean;
  inventory: InventoryApiOptions;
  /** Present in webhook mode: the route a Channel posts its updates to. */
  webhook?: { path: string; handler: RouteHandlerMethod };
  /** The Users' web dashboard, behind its own login. */
  dashboard?: DashboardOptions;
}): FastifyInstance {
  const server = Fastify({ logger: options.logger ?? true });
  server.get("/health", async () => ({ status: "ok" }));
  server.register(inventoryRoutes, { prefix: "/inventory", ...options.inventory });
  if (options.webhook) server.post(options.webhook.path, options.webhook.handler);
  if (options.dashboard) server.register(dashboardRoutes, options.dashboard);
  return server;
}
