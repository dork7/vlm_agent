import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/** Every module specifier reachable from `entry`, following relative imports. */
function reachableImports(entry: string): string[] {
  const seen = new Set<string>();
  const specifiers = new Set<string>();
  const visit = (file: string) => {
    if (seen.has(file)) return;
    seen.add(file);
    const source = readFileSync(file, "utf8");
    for (const [, specifier] of source.matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/g)) {
      specifiers.add(specifier!);
      if (specifier!.startsWith(".")) visit(resolve(dirname(file), specifier!));
    }
  };
  visit(resolve(entry));
  return [...specifiers];
}

describe("channel-neutral core (ADR 0005)", () => {
  it("never depends on grammY or the Telegram adapter", () => {
    const imports = reachableImports("src/core/core.ts");

    expect(imports.length).toBeGreaterThan(0);
    expect(imports.filter((specifier) => /grammy|telegram/i.test(specifier))).toEqual([]);
  });
});

describe("Task assignment module boundary", () => {
  it("does not cross into the bot modules", () => {
    const imports = reachableImports("src/assign/index.ts");
    expect(imports.filter(x => /(?:core|telegram|dashboard|db\.ts)/.test(x))).toEqual([]);
    for (const entry of ["src/core/core.ts", "src/telegram/adapter.ts", "src/dashboard/dashboard.ts"])
      expect(reachableImports(entry).filter(x => x.includes("/assign/"))).toEqual([]);
  });
});
