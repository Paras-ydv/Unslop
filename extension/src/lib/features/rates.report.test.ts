/**
 * Regenerates the `FIXTURE_FIRE_RATES` table in `vector.ts`.
 *
 * Not a test — it asserts nothing about correctness, it prints numbers to paste
 * back into the table. It lives as a vitest file because that is the only
 * runner configured here, and it is named `.report.ts` rather than `.test.ts`
 * so `npm test` does not pick it up.
 *
 *   npm run rates
 *
 * Run it after changing any detector, since a detector change moves the rates
 * and the explanation ranking reads from them. The rates are measured against
 * the synthetic corpus and inherit problem #12 — regenerate from real labels
 * once phase 4 has data.
 */

import { describe, it } from "vitest";
import type { ExtractedPost } from "@shared/types";
import { FIXTURES, type Fixture } from "./fixtures";
import { extractFeatures, FEATURE_KEYS, SIGNAL_FLOOR } from "./vector";

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

describe("fire rates", () => {
  it("prints the FIXTURE_FIRE_RATES table", () => {
    const sets = FIXTURES.map((fixture) => extractFeatures(asPost(fixture)));

    const rows = FEATURE_KEYS.map((descriptor) => {
      const values = sets.map((set) => {
        const group: Record<string, unknown> = { ...set[descriptor.group] };
        const value = group[descriptor.key];
        return typeof value === "number" ? value : 0;
      });
      const fired = values.filter((value) => value >= SIGNAL_FLOOR).length;
      return {
        key: descriptor.key,
        rate: fired / values.length,
        mean: values.reduce((a, b) => a + b, 0) / values.length,
      };
    }).sort((a, b) => b.rate - a.rate);

    const lines = rows.map(
      (row) => `  ${row.key}: ${Number(row.rate.toFixed(2))},`,
    );

    console.log(
      `\nMeasured at SIGNAL_FLOOR = ${SIGNAL_FLOOR} over ${FIXTURES.length} fixtures.\n` +
        "Paste into FIXTURE_FIRE_RATES in vector.ts:\n\n" +
        lines.join("\n") +
        "\n\nDetail (rate / mean value):\n" +
        rows
          .map(
            (row) =>
              `  ${row.key.padEnd(24)} ${(row.rate * 100).toFixed(0).padStart(4)}%  ${row.mean.toFixed(3)}`,
          )
          .join("\n") +
        "\n\nA feature at 0% has never fired on the corpus: it is unmeasured, not\n" +
        "rare, and nothing here exercises it. A feature at 100% explains nothing,\n" +
        "because a reason given for every post distinguishes none of them.\n",
    );
  });
});
