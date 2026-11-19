import type { AssignContext } from "./context.ts";
export async function purgeOld(ctx: AssignContext) {
  const now = ctx.now();
  await Promise.all([
    ctx.store.views.deleteMany({ viewedAt: { $lt: new Date(now.getTime() - ctx.config.viewRetentionDays * 86_400_000) } }),
    ctx.store.loginTokens.deleteMany({ expiresAt: { $lt: now } }),
    ctx.store.refreshTokens.deleteMany({ expiresAt: { $lt: now } }),
  ]);
}
