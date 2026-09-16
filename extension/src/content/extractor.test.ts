/**
 * Guards against the extractor scoring something that is not a single post.
 *
 * The failure this protects against was visible in the product: a badge
 * attached above the feed's "For you / Network" tabs, having scored the whole
 * page's text as one post. Length bounds are the backstop that makes that
 * impossible regardless of which selector path found the element.
 */

import { describe, expect, it } from "vitest";
import { normalizeText } from "../lib/normalize";

/** Mirrors the bounds in extractor.ts. */
const MIN_TEXT_LENGTH = 12;
const MAX_TEXT_LENGTH = 6000;

function withinBounds(text: string): boolean {
  const normalized = normalizeText(text);
  return normalized.length >= MIN_TEXT_LENGTH && normalized.length <= MAX_TEXT_LENGTH;
}

describe("post length bounds", () => {
  it("accepts an ordinary post", () => {
    expect(withinBounds("We cut p99 latency from 2.4s to 310ms by batching a query.")).toBe(true);
  });

  it("accepts a long but plausible post", () => {
    // LinkedIn's own limit is 3000 characters.
    expect(withinBounds("word ".repeat(560))).toBe(true);
  });

  it("rejects a whole feed's worth of text", () => {
    // The observed bug: a container holding many posts scored as one.
    expect(withinBounds("Some post body. ".repeat(500))).toBe(false);
  });

  it("rejects chrome and empty containers", () => {
    expect(withinBounds("")).toBe(false);
    expect(withinBounds("Follow")).toBe(false);
  });

  it("measures the normalized length, not the raw length", () => {
    // Whitespace-padded text that collapses under the minimum must be rejected.
    expect(withinBounds("  a  \n\n\n  b  ")).toBe(false);
  });
});
