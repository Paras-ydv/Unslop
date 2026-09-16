/**
 * Structural detectors: post *layout*, independent of vocabulary.
 *
 * These are the most language-agnostic signals available. A post can be
 * translated into any language and keep its emoji-bullet skeleton, its
 * one-sentence-per-line rhythm, and its one-word hook followed by whitespace.
 */

import { BULLET_GLYPHS } from "./lexicons";
import {
  clamp01,
  countEmoji,
  mean,
  ratio,
  saturate,
  startsWithBullet,
  stdDev,
  type TextStats,
} from "./text-utils";

export interface StructuralFeatures {
  /** Share of lines opening with a bullet glyph. 0–1. */
  bulletLineRatio: number;
  /** Emoji per 100 characters, saturated. 0–1. */
  emojiDensity: number;
  /** Share of lines that are a single sentence. 0–1. */
  oneSentencePerLineRatio: number;
  /** Share of lines that are very short (under 40 chars). 0–1. */
  shortLineRatio: number;
  /** Strength of the hook-line-then-break opener. 0–1. */
  hookPattern: number;
  /** Inverted, saturated line-length variance: 1 means very uniform. 0–1. */
  lineUniformity: number;
  /** Share of lines that are ALL CAPS or end in multiple punctuation marks. 0–1. */
  shoutingRatio: number;
}

/** A line under this length reads as a fragment rather than a paragraph. */
const SHORT_LINE_CHARS = 40;

/** Emoji per this many characters saturates the density score. */
const EMOJI_SCALE = 1.5;

/** Line-length std-dev at which uniformity is considered unremarkable. */
const UNIFORMITY_SCALE = 30;

/**
 * Detect the hook pattern: a short opening line, followed by a blank line,
 * before the body starts.
 *
 * This is the single most reliable structural tell on LinkedIn — the platform
 * truncates at roughly three lines, so templated posts front-load a cliffhanger
 * and push the rest below the fold.
 */
function detectHookPattern(text: string, lines: string[]): number {
  const first = lines[0];
  if (!first || lines.length < 2) return 0;

  // The blank line must appear in the raw text, not the filtered line list.
  const rawLines = text.split("\n");
  const firstRaw = rawLines.findIndex((l) => l.trim().length > 0);
  const followedByBlank =
    firstRaw >= 0 && (rawLines[firstRaw + 1]?.trim().length ?? 1) === 0;
  if (!followedByBlank) return 0;

  // Score by how punchy the opener is: shorter hooks are stronger tells.
  let score = 0.5;
  if (first.length <= 60) score += 0.2;
  if (first.length <= 30) score += 0.2;
  if (/[?:.]$/.test(first) || countEmoji(first) > 0) score += 0.1;
  return clamp01(score);
}

/** Lines in all caps, or ending in "!!" / "??" — typographic shouting. */
function isShouting(line: string): boolean {
  if (/[!?]{2,}$/.test(line)) return true;
  const letters = line.replace(/[^\p{L}]/gu, "");
  if (letters.length < 4) return false;
  return letters === letters.toUpperCase();
}

/** Compute all structural features for a post. */
export function extractStructural(stats: TextStats): StructuralFeatures {
  const { lines, text, charCount } = stats;
  if (lines.length === 0) {
    return {
      bulletLineRatio: 0,
      emojiDensity: 0,
      oneSentencePerLineRatio: 0,
      shortLineRatio: 0,
      hookPattern: 0,
      lineUniformity: 0,
      shoutingRatio: 0,
    };
  }

  let bulletLines = 0;
  let shortLines = 0;
  let singleSentenceLines = 0;
  let shoutingLines = 0;
  const lineLengths: number[] = [];

  for (const line of lines) {
    lineLengths.push(line.length);
    if (startsWithBullet(line, BULLET_GLYPHS)) bulletLines++;
    if (line.length < SHORT_LINE_CHARS) shortLines++;
    if (isShouting(line)) shoutingLines++;

    // Exactly one terminal punctuation mark, at the end, means the line is a
    // standalone sentence rather than part of a flowing paragraph.
    const terminals = (line.match(/[.!?]/g) ?? []).length;
    if (terminals <= 1 && line.length > 0) singleSentenceLines++;
  }

  // Uniformity is inverted variance: low spread in line lengths means the post
  // was assembled from a template rather than written as prose.
  const spread = stdDev(lineLengths);
  const lineUniformity =
    lines.length >= 3 ? clamp01(1 - saturate(spread, UNIFORMITY_SCALE)) : 0;

  return {
    bulletLineRatio: ratio(bulletLines, lines.length),
    emojiDensity: saturate(ratio(countEmoji(text) * 100, Math.max(charCount, 1)), EMOJI_SCALE),
    oneSentencePerLineRatio: ratio(singleSentenceLines, lines.length),
    shortLineRatio: ratio(shortLines, lines.length),
    hookPattern: detectHookPattern(text, lines),
    lineUniformity,
    shoutingRatio: ratio(shoutingLines, lines.length),
  };
}

/** Mean line length, exposed for the informational detector's length checks. */
export function meanLineLength(stats: TextStats): number {
  return mean(stats.lines.map((l) => l.length));
}
