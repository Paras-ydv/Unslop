import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Verdict } from "@shared/types";
import {
  allLabels,
  clearLabels,
  removeLabel,
  saveLabel,
  RATING_SCALE,
  summarizeLabels,
  toJsonl,
  toVerdict,
  SCORER_VERSION,
  type Label,
  type Rating,
} from "./labels";

/** Minimal chrome.storage.local stand-in; the test environment is node. */
function installStorage(): Record<string, unknown> {
  const store: Record<string, unknown> = {};
  vi.stubGlobal("chrome", {
    storage: {
      local: {
        get: async (key: string) => ({ [key]: store[key] }),
        set: async (items: Record<string, unknown>) => void Object.assign(store, items),
        remove: async (key: string) => void delete store[key],
      },
    },
  });
  return store;
}

/**
 * Build a label from the verdict it should collapse to.
 *
 * Picks the midpoint of each verdict's rating range, so the row is internally
 * consistent — `label` always equals `toVerdict(rating)`, as the panel writes
 * it. Tests that care about a specific point pass `rating` directly.
 */
function label(postId: string, want: Verdict, got: Verdict, rating?: Rating): Label {
  const chosen: Rating = rating ?? (want === "green" ? 1 : want === "red" ? 5 : 3);
  return {
    postId,
    text: `text for ${postId}`,
    rating: chosen,
    label: toVerdict(chosen),
    predicted: got,
    score: 0.5,
    at: "2026-09-16T00:00:00.000Z",
    scorerVersion: SCORER_VERSION,
  };
}

describe("label storage", () => {
  beforeEach(() => {
    installStorage();
  });

  it("returns an empty list before anything is saved", async () => {
    expect(await allLabels()).toEqual([]);
  });

  it("round-trips a label", async () => {
    const row = label("p1", "red", "green");
    await saveLabel(row);
    expect(await allLabels()).toEqual([row]);
  });

  it("replaces an earlier judgment of the same post", async () => {
    await saveLabel(label("p1", "red", "green"));
    await saveLabel(label("p1", "yellow", "green"));

    const rows = await allLabels();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.label).toBe("yellow");
  });

  it("keeps labels for different posts side by side", async () => {
    await saveLabel(label("p1", "red", "green"));
    await saveLabel(label("p2", "green", "red"));
    expect(await allLabels()).toHaveLength(2);
  });

  it("removes a single label", async () => {
    await saveLabel(label("p1", "red", "green"));
    await saveLabel(label("p2", "green", "red"));
    await removeLabel("p1");

    const rows = await allLabels();
    expect(rows.map((r) => r.postId)).toEqual(["p2"]);
  });

  it("clears every label", async () => {
    await saveLabel(label("p1", "red", "green"));
    await clearLabels();
    expect(await allLabels()).toEqual([]);
  });

  it("reports failure rather than throwing when storage is missing", async () => {
    vi.stubGlobal("chrome", undefined);
    // False, not undefined: the caller has to be able to tell the user the
    // rating did not land. Silently resolving is how a session gets lost.
    await expect(saveLabel(label("p1", "red", "green"))).resolves.toBe(false);
    expect(await allLabels()).toEqual([]);
  });

  it("reports success when the write lands", async () => {
    await expect(saveLabel(label("p1", "red", "green"))).resolves.toBe(true);
  });

  it("treats a malformed stored value as empty", async () => {
    const store = installStorage();
    store["unslop:labels"] = "not an array";
    expect(await allLabels()).toEqual([]);
  });
});

describe("summarizeLabels", () => {
  it("reports nulls and zeroes for an empty set", () => {
    const stats = summarizeLabels([]);
    expect(stats.total).toBe(0);
    expect(stats.agreement).toBeNull();
    expect(stats.byLabel).toEqual({ green: 0, yellow: 0, red: 0 });
  });

  it("counts labels by class", () => {
    const stats = summarizeLabels([
      label("a", "red", "red"),
      label("b", "red", "green"),
      label("c", "green", "green"),
    ]);
    expect(stats.byLabel).toEqual({ green: 1, yellow: 0, red: 2 });
    expect(stats.total).toBe(3);
  });

  it("counts a disagreement only when the verdicts differ", () => {
    const stats = summarizeLabels([
      label("a", "red", "red"),
      label("b", "red", "green"),
    ]);
    expect(stats.disagreements).toBe(1);
    expect(stats.agreement).toBe(0.5);
  });

  it("reports the 1–5 spread alongside the three-way split", () => {
    const stats = summarizeLabels([
      label("a", "green", "green", 1),
      label("b", "green", "green", 2),
      label("c", "yellow", "yellow", 3),
      label("d", "red", "red", 4),
      label("e", "red", "red", 5),
    ]);
    expect(stats.byRating).toEqual({ 1: 1, 2: 1, 3: 1, 4: 1, 5: 1 });
    expect(stats.byLabel).toEqual({ green: 2, yellow: 1, red: 2 });
  });

  it("derives the class from the rating, not the stored verdict", () => {
    // A row written under different cut points must count under the current
    // ones — that is the whole reason the rating is the stored truth.
    const stale: Label = { ...label("a", "green", "green", 5), label: "green" };
    expect(summarizeLabels([stale]).byLabel).toEqual({ green: 0, yellow: 0, red: 1 });
  });
});

describe("toVerdict", () => {
  it("collapses the scale at the documented boundaries", () => {
    expect(toVerdict(1)).toBe("green");
    expect(toVerdict(2)).toBe("green");
    expect(toVerdict(3)).toBe("yellow");
    expect(toVerdict(4)).toBe("red");
    expect(toVerdict(5)).toBe("red");
  });

  it("covers all five points with a label and a hint", () => {
    expect(RATING_SCALE.map((p) => p.rating)).toEqual([1, 2, 3, 4, 5]);
    for (const point of RATING_SCALE) {
      expect(point.label, `rating ${point.rating}`).toBeTruthy();
      expect(point.hint, `rating ${point.rating}`).toBeTruthy();
    }
  });
});

describe("toJsonl", () => {
  it("emits one parseable object per line", () => {
    const rows = [label("a", "red", "green"), label("b", "green", "red")];
    const lines = toJsonl(rows).split("\n");

    expect(lines).toHaveLength(2);
    expect(lines.map((line) => JSON.parse(line))).toEqual(rows);
  });

  it("emits nothing for an empty set", () => {
    expect(toJsonl([])).toBe("");
  });

  it("escapes newlines inside post text", () => {
    const row = { ...label("a", "red", "green"), text: "line one\nline two" };
    const lines = toJsonl([row]).split("\n");

    // A post body containing newlines must not split into two JSONL records.
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!).text).toBe("line one\nline two");
  });
});
