import Fastify, { type FastifyInstance, type RouteHandlerMethod } from "fastify";
import { dashboardRoutes, type DashboardOptions } from "./dashboard/dashboard.ts";
import { inventoryRoutes, type InventoryApiOptions } from "./inventory/api.ts";
import { assignRoutes, type AssignOptions } from "./assign/index.ts";

export function buildServer(options: {
  logger?: boolean;
  inventory: InventoryApiOptions;
  /** Present in webhook mode: the route a Channel posts its updates to. */
  webhook?: { path: string; handler: RouteHandlerMethod };
  /** The Users' web dashboard, behind its own login. */
  dashboard?: DashboardOptions;
  assign?: AssignOptions;
}): FastifyInstance {
  const server = Fastify({ trustProxy: options.assign?.config.trustProxy ?? false, logger: options.logger === false ? false : {
    serializers: { req: (request) => ({ method: request.method, url: request.url?.replace(/\/l\/[A-Za-z0-9]{10}/g, "/l/[redacted]").replace(/([?&]token=)[^&]+/g, "$1[redacted]") }) },
  } });
  server.get("/health", async () => ({ status: "ok" }));
  server.register(inventoryRoutes, { prefix: "/inventory", ...options.inventory });
  if (options.webhook) server.post(options.webhook.path, options.webhook.handler);
  if (options.dashboard) server.register(dashboardRoutes, options.dashboard);
  if (options.assign) server.register(assignRoutes, options.assign);
  return server;
}
