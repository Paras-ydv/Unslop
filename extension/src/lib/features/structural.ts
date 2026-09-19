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

/**
 * A capitalised run inside an otherwise normal line.
 *
 * Five letters or more, or one of the short emphasis words. The length floor is
 * the whole difficulty: an acronym is also a capitalised run, and "the API
 * returned 500" is not shouting. Five clears the common technical ones (API,
 * SQL, CEO, HTTP, JSON) at the cost of missing a shouted five-letter word, which
 * is the right trade — a false positive here penalises exactly the substantive
 * technical posts the scorer is meant to defend.
 *
 * The allowlist buys back the short words that carry emphasis and are never
 * acronyms. It is a closed set of English intensifiers, so it does not
 * generalise; a non-English feed gets the length rule only, which is a known
 * limit rather than a silent one.
 */
const SHOUTED_WORD =
  /(?:^|[^\p{L}])(?:\p{Lu}{5,}|NOT|NEVER|ALL|ONLY|MUST|STOP|EVERY|NOW)(?:[^\p{L}]|$)/u;

/**
 * Lines in all caps, ending in "!!" / "??", or shouting a word mid-sentence.
 *
 * The whole-line test alone was close to dead: it needs *every* letter on the
 * line capitalised, and real typographic shouting is one word inside an
 * otherwise ordinary sentence — "AI will change EVERYTHING about how we work."
 * The corpus's own shouting fixture scored 0.17, because only its headline was
 * fully capitalised, so a feature written for that fixture did not fire on it.
 *
 * An embedded caps run has to be multi-letter to count, or every acronym in a
 * technical post reads as shouting — "the API returned 500" is not shouting,
 * and false-positiving on substantive posts is the expensive direction. Four
 * letters clears the common ones (API, SQL, CEO, GPU) while still catching
 * NEVER, ALWAYS and EVERYTHING; `\p{Lu}` rather than `A-Z` so it does not
 * quietly treat non-Latin scripts as never shouting.
 */
function isShouting(line: string): boolean {
  // Anchored past trailing emoji and whitespace, not at the raw end: "see
  // this!! 👇" is the same shout as "see this!!", and requiring `$` missed
  // every line that closed with a pointer emoji — which slop reliably does.
  if (/[!?]{2,}[^\p{L}\p{N}]*$/u.test(line)) return true;

  const letters = line.replace(/[^\p{L}]/gu, "");
  if (letters.length >= 4 && letters === letters.toUpperCase()) return true;

  // A shouted word inside a normal line. Requires a lowercase letter somewhere,
  // so a fully-capitalised line is not counted twice by a different rule.
  if (!/\p{Ll}/u.test(line)) return false;
  return SHOUTED_WORD.test(line);
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
