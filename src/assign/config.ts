export type AssignConfig = {
  publicUrl: string; jwtSecret: string; signupMode: "open" | "allowlist";
  allowedEmails: string[]; resend?: { apiKey: string; from: string };
  viewRetentionDays: number; secureCookies: boolean; trustProxy: boolean; noLogin: boolean;
};

export class AssignConfigError extends Error {}

export function loadAssignConfig(env: Record<string, string | undefined>): AssignConfig | null {
  const noLogin = env.ASSIGN_NO_LOGIN === "true";
  const secret = env.ASSIGN_JWT_SECRET?.trim() || (noLogin ? "local-no-login-mode-secret-placeholder" : "");
  const rawUrl = env.PUBLIC_URL?.trim() || (noLogin ? `http://127.0.0.1:${env.PORT || 3000}` : "");
  if (!secret || !rawUrl) return null;
  if (secret.length < 32) throw new AssignConfigError("ASSIGN_JWT_SECRET needs at least 32 characters");
  let url: URL;
  try { url = new URL(rawUrl); } catch { throw new AssignConfigError("PUBLIC_URL must be an absolute URL"); }
  if (!(["http:", "https:"].includes(url.protocol)) || url.pathname !== "/" || url.search || url.hash)
    throw new AssignConfigError("PUBLIC_URL must be an HTTP(S) origin");
  if (noLogin && (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || ![undefined, "127.0.0.1", "localhost", "::1"].includes(env.HOST))) throw new AssignConfigError("ASSIGN_NO_LOGIN is only for a local-only app");
  const signupMode = env.SIGNUP_MODE?.trim() || "open";
  if (signupMode !== "open" && signupMode !== "allowlist") throw new AssignConfigError("SIGNUP_MODE must be open or allowlist");
  const apiKey = env.RESEND_API_KEY?.trim();
  const from = env.MAIL_FROM?.trim();
  if (apiKey && !from) throw new AssignConfigError("MAIL_FROM is required with RESEND_API_KEY");
  const viewRetentionDays = Number(env.ASSIGN_VIEW_RETENTION_DAYS || 90);
  if (!Number.isInteger(viewRetentionDays) || viewRetentionDays < 1) throw new AssignConfigError("ASSIGN_VIEW_RETENTION_DAYS must be positive");
  return { publicUrl: url.origin, jwtSecret: secret, signupMode,
    allowedEmails: (env.ASSIGN_ALLOWED_EMAILS || "").split(",").map(x => x.trim().toLowerCase()).filter(Boolean),
    ...(apiKey ? { resend: { apiKey, from: from! } } : {}), viewRetentionDays,
    secureCookies: url.protocol === "https:", trustProxy: env.ASSIGN_TRUST_PROXY === "true", noLogin };
}
