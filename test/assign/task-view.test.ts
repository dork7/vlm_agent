import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

const script = readFileSync(new URL("../../src/assign/views/task-view.ejs", import.meta.url), "utf8").replace(/<\/?script>/g, "");

function openPage(storage: Map<string, string>, storageBlocked = false) {
  const collection = { dataset: { view: "list" } };
  const buttons = ["list", "grid"].map(view => ({
    dataset: { taskView: view }, pressed: "", click: () => {},
    setAttribute(_name: string, value: string) { this.pressed = value; },
    addEventListener(_event: string, listener: () => void) { this.click = listener; },
  }));
  const toggle = { hidden: true, querySelectorAll: () => buttons };
  runInNewContext(script, {
    document: { getElementById: (id: string) => id === "task-collection" ? collection : toggle },
    localStorage: {
      getItem: (key: string) => { if (storageBlocked) throw new Error("Storage blocked"); return storage.get(key); },
      setItem: (key: string, value: string) => { if (storageBlocked) throw new Error("Storage blocked"); storage.set(key, value); },
    },
  });
  return { collection, toggle, list: buttons[0]!, grid: buttons[1]! };
}

describe("Task view preference", () => {
  it("switches layouts and remembers the choice when revisiting the page", () => {
    const storage = new Map<string, string>();
    const page = openPage(storage);
    expect(page.toggle.hidden).toBe(false);
    expect(page.collection.dataset.view).toBe("list");
    page.grid.click();
    expect(page.collection.dataset.view).toBe("grid");
    expect(page.grid.pressed).toBe("true");
    expect(page.list.pressed).toBe("false");
    const revisited = openPage(storage);
    expect(revisited.collection.dataset.view).toBe("grid");
    revisited.list.click();
    expect(openPage(storage).collection.dataset.view).toBe("list");
  });

  it("still switches layouts when browser storage is blocked", () => {
    const page = openPage(new Map(), true);
    page.grid.click();
    expect(page.collection.dataset.view).toBe("grid");
    expect(page.grid.pressed).toBe("true");
  });

  it("falls back to list view for an invalid saved preference", () => {
    expect(openPage(new Map([["ta-task-view", "unknown"]])).collection.dataset.view).toBe("list");
  });
});
