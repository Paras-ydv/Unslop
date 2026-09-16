import { beforeEach, describe, expect, it, vi } from "vitest";
import { cacheSize, clearCache, readCache, writeCache } from "./cache";
import { SCORER_VERSION } from "./labels";

/** Minimal sessionStorage stand-in; the test environment is node, not jsdom. */
function installStorage(): Map<string, string> {
  const store = new Map<string, string>();
  vi.stubGlobal("sessionStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    key: (i: number) => [...store.keys()][i] ?? null,
    get length() {
      return store.size;
    },
  });
  return store;
}

const verdict = {
  verdict: "red",
  score: 0.91,
  confidence: 0.8,
  signals: [{ key: "ctaPhrases", label: "Asks for likes", weight: 0.9 }],
  uncertain: false,
};

describe("cache", () => {
  beforeEach(() => {
    installStorage();
    clearCache();
  });

  it("returns null for an unknown post", () => {
    expect(readCache("nope")).toBeNull();
  });

  it("round-trips a verdict", () => {
    writeCache("post-1", verdict);
    expect(readCache("post-1")).toEqual(verdict);
  });

  it("reads through to storage when the memory mirror is cold", () => {
    const store = installStorage();
    store.set(`unslop:${SCORER_VERSION}:post-2`, JSON.stringify(verdict));
    expect(readCache("post-2")).toEqual(verdict);
  });

  it("treats malformed entries as a miss rather than throwing", () => {
    const store = installStorage();
    store.set(`unslop:${SCORER_VERSION}:bad`, "{not json");
    expect(readCache("bad")).toBeNull();
  });

  it("survives storage being unavailable", () => {
    vi.stubGlobal("sessionStorage", {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {},
      key: () => null,
      length: 0,
    });
    clearCache();
    expect(() => writeCache("post-3", verdict)).not.toThrow();
    // The in-memory mirror still serves the value for the life of the page.
    expect(readCache("post-3")).toEqual(verdict);
  });

  it("clears both memory and storage", () => {
    const store = installStorage();
    writeCache("post-4", verdict);
    expect(cacheSize()).toBe(1);

    clearCache();
    expect(cacheSize()).toBe(0);
    expect(readCache("post-4")).toBeNull();
    expect([...store.keys()].filter((k) => k.startsWith("unslop:"))).toEqual([]);
  });

  it("leaves unrelated storage keys alone", () => {
    const store = installStorage();
    store.set("someone-elses-key", "keep me");
    writeCache("post-5", verdict);
    clearCache();
    expect(store.get("someone-elses-key")).toBe("keep me");
  });
});
