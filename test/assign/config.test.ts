import { describe, expect, it, vi } from "vitest";
import { buildServer } from "../../src/server.ts";
import { AssignConfigError, loadAssignConfig } from "../../src/assign/config.ts";
import { consoleMailer, resendMailer } from "../../src/assign/mailer.ts";

describe("Task assignment configuration and mail delivery", () => {
  it("leaves the module off without both settings", async () => {
    expect(loadAssignConfig({})).toBeNull();
    expect(loadAssignConfig({ PUBLIC_URL: "https://tasks.example" })).toBeNull();
    const server = buildServer({ logger: false, inventory: { items: [], apiKey: "test" } });
    expect((await server.inject("/assign")).statusCode).toBe(404);
    await server.close();
  });
  it("validates the secret, sign-up mode, sender and origin", () => {
    const env = { PUBLIC_URL: "https://tasks.example/", ASSIGN_JWT_SECRET: "x".repeat(32) };
    expect(loadAssignConfig(env)?.secureCookies).toBe(true);
    expect(() => loadAssignConfig({ ...env, ASSIGN_JWT_SECRET: "short" })).toThrow(AssignConfigError);
    expect(() => loadAssignConfig({ ...env, SIGNUP_MODE: "closed" })).toThrow(AssignConfigError);
    expect(() => loadAssignConfig({ ...env, RESEND_API_KEY: "re_test" })).toThrow(/MAIL_FROM/);
    expect(() => loadAssignConfig({ ...env, PUBLIC_URL: "javascript:bad" })).toThrow(AssignConfigError);
  });
  it("limits the no-login mode to loopback", () => {
    expect(loadAssignConfig({ ASSIGN_NO_LOGIN: "true", PORT: "4000" })?.publicUrl).toBe("http://127.0.0.1:4000");
    expect(() => loadAssignConfig({ ASSIGN_NO_LOGIN: "true", PUBLIC_URL: "https://tasks.example" })).toThrow(/local-only/);
    expect(() => loadAssignConfig({ ASSIGN_NO_LOGIN: "true", HOST: "0.0.0.0" })).toThrow(/local-only/);
  });
  it("passes the link to Resend and prints it in console mode", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));
    const message = { to: "owner@example.com", subject: "Log in", text: "http://tasks.example/assign/auth?token=secret" };
    await resendMailer("re_test", "Task App <login@example.com>").send(message);
    const [url, options] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.resend.com/emails");
    expect((options?.headers as Record<string, string>).Authorization).toBe("Bearer re_test");
    expect(String(options?.body)).toContain(message.text);
    expect(String(options?.body)).toContain("Task App <login@example.com>");
    fetchMock.mockRestore();
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await consoleMailer().send(message);
    expect(log).toHaveBeenCalledWith(message.text);
    log.mockRestore();
  });
});
