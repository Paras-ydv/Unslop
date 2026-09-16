/**
 * Rule-engine accuracy against the labeled corpus.
 *
 * This is the test that decides whether phase 3 works. Unlike the phase-2
 * separation tests, these assert real verdicts, so tuning `weights.ts` shows up
 * here immediately.
 */

import { describe, expect, it } from "vitest";
import type { ExtractedPost, Verdict } from "@shared/types";
import { FIXTURES, type Fixture } from "../features/fixtures";
import { scorePost, summarize, verdictLabel } from "./scorer";
import { THRESHOLDS } from "./weights";

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

const scored = FIXTURES.map((f) => ({ fixture: f, result: scorePost(asPost(f)) }));

/** Distance between two verdicts on the green→yellow→red ordinal scale. */
const RANK: Record<Verdict, number> = { green: 0, yellow: 1, red: 2 };
function distance(a: Verdict, b: Verdict): number {
  return Math.abs(RANK[a] - RANK[b]);
}

describe("scorer output shape", () => {
  it("produces a score within 0 and 1 for every fixture", () => {
    for (const { fixture, result } of scored) {
      expect(result.score, fixture.id).toBeGreaterThanOrEqual(0);
      expect(result.score, fixture.id).toBeLessThanOrEqual(1);
    }
  });

  it("produces a confidence within 0 and 1", () => {
    for (const { fixture, result } of scored) {
      expect(result.confidence, fixture.id).toBeGreaterThanOrEqual(0);
      expect(result.confidence, fixture.id).toBeLessThanOrEqual(1);
    }
  });

  it("agrees with its own thresholds", () => {
    for (const { fixture, result } of scored) {
      const expected: Verdict =
        result.score >= THRESHOLDS.red
          ? "red"
          : result.score <= THRESHOLDS.green
            ? "green"
            : "yellow";
      expect(result.verdict, fixture.id).toBe(expected);
    }
  });

  it("attaches at least one signal to every non-trivial post", () => {
    for (const { fixture, result } of scored) {
      if (result.features.wordCount < 10) continue;
      expect(result.signals.length, fixture.id).toBeGreaterThan(0);
    }
  });

  it("reports rules as the source", () => {
    for (const { result } of scored) expect(result.source).toBe("rules");
  });
});

describe("accuracy on the labeled corpus", () => {
  it("never inverts a verdict — no red labeled green or vice versa", () => {
    const inversions = scored.filter(
      ({ fixture, result }) => distance(fixture.label, result.verdict) === 2,
    );
    expect(
      inversions.map((i) => `${i.fixture.id}: want ${i.fixture.label}, got ${i.result.verdict}`),
    ).toEqual([]);
  });

  it("classifies at least 75% of fixtures exactly", () => {
    const exact = scored.filter(({ fixture, result }) => fixture.label === result.verdict);
    const accuracy = exact.length / scored.length;
    expect(
      accuracy,
      `exact: ${exact.length}/${scored.length}\n` +
        scored
          .filter(({ fixture, result }) => fixture.label !== result.verdict)
          .map((m) => `  ${m.fixture.id}: want ${m.fixture.label}, got ${m.result.verdict} (${m.result.score.toFixed(2)})`)
          .join("\n"),
    ).toBeGreaterThanOrEqual(0.75);
  });

  it("scores every red fixture above every green fixture", () => {
    const maxGreen = Math.max(
      ...scored.filter((s) => s.fixture.label === "green").map((s) => s.result.score),
    );
    const minRed = Math.min(
      ...scored.filter((s) => s.fixture.label === "red").map((s) => s.result.score),
    );
    expect(minRed).toBeGreaterThan(maxGreen);
  });
});

describe("value over provenance", () => {
  it("passes a substantive post that uses bullets", () => {
    const result = scored.find((s) => s.fixture.id === "edge-bullets-with-substance")!.result;
    expect(result.verdict).toBe("green");
  });

  it("passes a substantive post that uses emoji", () => {
    const result = scored.find((s) => s.fixture.id === "green-with-numbers-and-emoji")!.result;
    expect(result.verdict).not.toBe("red");
  });

  it("flags hand-written bait carrying no AI tells", () => {
    const { result } = scored.find((s) => s.fixture.id === "red-pure-cta")!;
    expect(result.verdict).toBe("red");
    expect(result.features.linguistic.llmTells).toBe(0);
  });

  it("does not confidently condemn a very short post", () => {
    const { result } = scored.find((s) => s.fixture.id === "edge-very-short-green")!;
    expect(result.verdict).not.toBe("red");
  });
});

describe("explanations", () => {
  it("names a quality signal when explaining a green verdict", () => {
    const { result } = scored.find((s) => s.fixture.id === "green-postmortem")!;
    expect(result.verdict).toBe("green");
    expect(result.signals.some((s) => s.weight < 0)).toBe(true);
    expect(summarize(result)).not.toBe("No strong signals");
  });

  it("names a slop signal when explaining a red verdict", () => {
    const { result } = scored.find((s) => s.fixture.id === "red-classic-hook-list")!;
    expect(result.verdict).toBe("red");
    expect(result.signals[0]!.weight).toBeGreaterThan(0);
  });

  it("leads with signals that explain the verdict, strongest first", () => {
    for (const { fixture, result } of scored) {
      const leading = result.verdict === "green" ? -1 : 1;
      const sides = result.signals.map((s) => Math.sign(s.weight));

      // Every verdict-explaining signal comes before every opposing one.
      const lastLeading = sides.lastIndexOf(leading);
      const firstOpposing = sides.findIndex((s) => s !== leading);
      if (lastLeading !== -1 && firstOpposing !== -1) {
        expect(firstOpposing, fixture.id).toBeGreaterThan(lastLeading);
      }

      // Within each side, magnitude descends.
      for (const side of [leading, -leading]) {
        const magnitudes = result.signals
          .filter((s) => Math.sign(s.weight) === side)
          .map((s) => Math.abs(s.weight));
        expect([...magnitudes].sort((a, b) => b - a), fixture.id).toEqual(magnitudes);
      }
    }
  });

  it("has a label for every verdict", () => {
    expect(verdictLabel("green")).toBeTruthy();
    expect(verdictLabel("yellow")).toBeTruthy();
    expect(verdictLabel("red")).toBeTruthy();
  });
});

describe("performance budget", () => {
  it("scores a post well inside the 150ms budget", () => {
    for (const { fixture } of scored) scorePost(asPost(fixture));

    const start = performance.now();
    const runs = 20;
    for (let i = 0; i < runs; i++) {
      for (const { fixture } of scored) scorePost(asPost(fixture));
    }
    const perPost = (performance.now() - start) / (runs * scored.length);
    expect(perPost).toBeLessThan(5);
  });
});
