/**
 * Corpus-level checks over the labeled fixtures.
 *
 * Phase 2 has no scorer, so these do not assert verdicts — they assert that the
 * features *separate* the labeled classes. If red and green fixtures produce
 * overlapping feature distributions, the rule engine in phase 3 cannot succeed
 * no matter how its weights are tuned.
 */

import { describe, expect, it } from "vitest";
import type { ExtractedPost } from "@shared/types";
import { FIXTURES, fixturesByLabel, type Fixture } from "./fixtures";
import {
  extractFeatures,
  informativeness,
  SIGNAL_FLOOR,
  toSignals,
  toVector,
  FEATURE_KEYS,
} from "./vector";
import { mean } from "./text-utils";

/** Wrap a fixture as an ExtractedPost so the real entry point is exercised. */
function asPost(fixture: Fixture): ExtractedPost {
  return {
    id: fixture.id,
    idIsStable: true,
    text: fixture.text,
    rawText: fixture.text,
    author: "Fixture Author",
    truncated: false,
    links: fixture.links ?? [],
    hasMedia: false,
    isReshare: false,
    extractionMs: 0,
  };
}

const features = new Map(
  FIXTURES.map((f) => [f.id, extractFeatures(asPost(f))] as const),
);

/** Mean of one feature across every fixture carrying a given label. */
function meanFor(label: "red" | "yellow" | "green", pick: (f: ReturnType<typeof extractFeatures>) => number) {
  return mean(fixturesByLabel(label).map((f) => pick(features.get(f.id)!)));
}

describe("corpus integrity", () => {
  it("has fixtures in every class", () => {
    expect(fixturesByLabel("red").length).toBeGreaterThanOrEqual(8);
    expect(fixturesByLabel("yellow").length).toBeGreaterThanOrEqual(5);
    expect(fixturesByLabel("green").length).toBeGreaterThanOrEqual(8);
  });

  it("has unique fixture ids", () => {
    expect(new Set(FIXTURES.map((f) => f.id)).size).toBe(FIXTURES.length);
  });
});

describe("feature vector contract", () => {
  it("emits one number per declared feature key", () => {
    for (const fixture of FIXTURES) {
      const vector = toVector(features.get(fixture.id)!);
      expect(vector).toHaveLength(FEATURE_KEYS.length);
      expect(vector.every((v) => Number.isFinite(v))).toBe(true);
    }
  });

  it("keeps every feature within 0 and 1", () => {
    for (const fixture of FIXTURES) {
      const vector = toVector(features.get(fixture.id)!);
      for (const [index, value] of vector.entries()) {
        expect(
          value,
          `${fixture.id} → ${FEATURE_KEYS[index]!.key} = ${value}`,
        ).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(1);
      }
    }
  });

  it("declares unique feature keys", () => {
    expect(new Set(FEATURE_KEYS.map((f) => f.key)).size).toBe(FEATURE_KEYS.length);
  });
});

describe("class separation", () => {
  it("scores red fixtures higher on engagement bait than green", () => {
    const red = meanFor("red", (f) => f.engagementBait.ctaPhrases + f.engagementBait.closingHook);
    const green = meanFor("green", (f) => f.engagementBait.ctaPhrases + f.engagementBait.closingHook);
    expect(red).toBeGreaterThan(green + 0.4);
  });

  it("scores red fixtures higher on stock phrasing than green", () => {
    const red = meanFor("red", (f) =>
      f.linguistic.hookOpeners + f.linguistic.hyperbole + f.linguistic.llmTells);
    const green = meanFor("green", (f) =>
      f.linguistic.hookOpeners + f.linguistic.hyperbole + f.linguistic.llmTells);
    expect(red).toBeGreaterThan(green + 0.3);
  });

  it("scores green fixtures higher on informational density than red", () => {
    const pick = (f: ReturnType<typeof extractFeatures>) =>
      f.informational.numberDensity + f.informational.entityDensity;
    expect(meanFor("green", pick)).toBeGreaterThan(meanFor("red", pick) + 0.3);
  });

  it("scores red fixtures higher on vagueness than green", () => {
    expect(meanFor("red", (f) => f.informational.vagueness)).toBeGreaterThan(
      meanFor("green", (f) => f.informational.vagueness),
    );
  });

  it("places yellow between red and green on a combined slop axis", () => {
    const slopAxis = (f: ReturnType<typeof extractFeatures>) =>
      f.linguistic.hookOpeners +
      f.linguistic.hyperbole +
      f.engagementBait.ctaPhrases +
      f.engagementBait.closingHook -
      f.informational.numberDensity -
      f.informational.entityDensity;

    const red = meanFor("red", slopAxis);
    const yellow = meanFor("yellow", slopAxis);
    const green = meanFor("green", slopAxis);

    expect(red).toBeGreaterThan(yellow);
    expect(yellow).toBeGreaterThan(green);
  });
});

describe("value over provenance", () => {
  it("does not condemn a substantive post for using bullets", () => {
    const bulleted = features.get("edge-bullets-with-substance")!;
    expect(bulleted.structural.bulletLineRatio).toBeGreaterThan(0.5);
    // Formatting fires, but the informational counter-signal must fire harder.
    const substance =
      bulleted.informational.numberDensity + bulleted.informational.entityDensity;
    expect(substance).toBeGreaterThan(0.8);
  });

  it("does not condemn a substantive post for using emoji", () => {
    const f = features.get("green-with-numbers-and-emoji")!;
    expect(f.informational.numberDensity).toBeGreaterThan(0.5);
    expect(f.engagementBait.ctaPhrases).toBe(0);
  });

  it("flags hand-written bait with no AI tells at all", () => {
    const f = features.get("red-pure-cta")!;
    expect(f.linguistic.llmTells).toBe(0);
    expect(f.engagementBait.ctaPhrases).toBeGreaterThan(0.7);
    expect(f.engagementBait.closingHook).toBeGreaterThan(0.5);
  });

  it("leaves a short factual post unflagged", () => {
    const f = features.get("edge-very-short-green")!;
    expect(f.engagementBait.ctaPhrases).toBe(0);
    expect(f.linguistic.hookOpeners).toBe(0);
    expect(f.structural.bulletLineRatio).toBe(0);
  });
});

describe("signals", () => {
  it("surfaces slop signals with positive weight on red fixtures", () => {
    const signals = toSignals(features.get("red-classic-hook-list")!);
    expect(signals.length).toBeGreaterThan(2);
    expect(signals.some((s) => s.weight > 0)).toBe(true);
  });

  it("surfaces quality signals with negative weight on green fixtures", () => {
    const signals = toSignals(features.get("green-postmortem")!);
    expect(signals.some((s) => s.weight < 0)).toBe(true);
  });

  it("orders signals by informativeness and respects the limit", () => {
    const signals = toSignals(features.get("red-classic-hook-list")!, 3);
    expect(signals.length).toBeLessThanOrEqual(3);
    // Raw magnitude no longer decides the order: a feature that fires on most
    // posts is a weaker explanation than a rarer one of similar size.
    const ranks = signals.map((s) => Math.abs(s.weight) * informativeness(s.key));
    expect([...ranks].sort((a, b) => b - a)).toEqual(ranks);
  });

  it("omits features too weak to be worth naming", () => {
    for (const fixture of FIXTURES) {
      for (const signal of toSignals(features.get(fixture.id)!)) {
        expect(Math.abs(signal.weight), fixture.id).toBeGreaterThanOrEqual(SIGNAL_FLOOR);
      }
    }
  });
});

describe("corpus coverage", () => {
  /**
   * Every weighted feature must fire on at least one fixture.
   *
   * Four of them fired on none — `shoutingRatio`, `corporateFiller`,
   * `prescriptiveness` and (below the floor) `citationDensity` — which meant
   * they carried weight in the scorer on no evidence at all, and nothing here
   * would have noticed them breaking. `shoutingRatio` was in fact broken: it
   * required a whole capitalised line, so the corpus's own shouting fixture
   * scored 0.17 and the detector written for that fixture did not fire on it.
   *
   * A feature nothing exercises is a guess wearing a coefficient. Adding a
   * feature now means adding a fixture that triggers it.
   */
  it("exercises every weighted feature at least once", () => {
    const unexercised = FEATURE_KEYS.filter((descriptor) => {
      if (descriptor.direction === "neutral") return false;
      return !FIXTURES.some((fixture) => {
        const group: Record<string, unknown> = { ...features.get(fixture.id)![descriptor.group] };
        const value = group[descriptor.key];
        return typeof value === "number" && value >= SIGNAL_FLOOR;
      });
    }).map((descriptor) => descriptor.key);

    expect(unexercised, `no fixture fires: ${unexercised.join(", ")}`).toEqual([]);
  });
});

describe("performance budget", () => {
  it("computes features well inside the per-post budget", () => {
    // Warm up, so the measurement is not dominated by first-call JIT.
    for (const fixture of FIXTURES) extractFeatures(asPost(fixture));

    const start = performance.now();
    const runs = 20;
    for (let i = 0; i < runs; i++) {
      for (const fixture of FIXTURES) extractFeatures(asPost(fixture));
    }
    const perPost = (performance.now() - start) / (runs * FIXTURES.length);

    // The phase-3 budget is 150ms for the whole classification. Feature
    // extraction should be a rounding error inside it.
    expect(perPost).toBeLessThan(5);
  });
});
