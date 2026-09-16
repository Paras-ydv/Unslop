/**
 * Shared text primitives for the feature detectors.
 *
 * Every function here is pure and allocation-conscious: the detectors run on
 * every post in a scroll batch, so the whole feature pass has a few
 * milliseconds of budget. Regexes are anchored and non-backtracking; nothing
 * here is quadratic in input length.
 */

/** A post split into the units the detectors work over. Computed once, reused. */
export interface TextStats {
  /** Normalized text, unchanged from the extractor. */
  text: string;
  /** Lowercased text, for case-insensitive phrase matching. */
  lower: string;
  /** Non-empty lines, trimmed. */
  lines: string[];
  /** Sentences across the whole post. */
  sentences: string[];
  /** Word tokens, lowercased, punctuation stripped. */
  words: string[];
  /** Total character count. */
  charCount: number;
}

/**
 * Sentence boundaries: terminal punctuation followed by whitespace.
 *
 * Deliberately naive — it splits "Inc. announced" wrongly, but abbreviations
 * are rare in LinkedIn posts and the cost of a full sentence tokenizer is not
 * worth it. Newlines also terminate sentences, since slop posts routinely omit
 * terminal punctuation on standalone lines.
 */
const SENTENCE_SPLIT = /(?<=[.!?])\s+|\n+/;

/** Word characters, including apostrophes and internal hyphens. */
const WORD_MATCH = /[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu;

/** Build the shared stats bundle for a post body. */
export function analyzeText(text: string): TextStats {
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const sentences = text
    .split(SENTENCE_SPLIT)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  const words = (text.toLowerCase().match(WORD_MATCH) ?? []) as string[];

  return {
    text,
    lower: text.toLowerCase(),
    lines,
    sentences,
    words,
    charCount: text.length,
  };
}

/**
 * Count how many phrases from a lexicon appear in the text.
 *
 * Returns both the match count and the matched phrases, since the "Why?" panel
 * needs to quote the specific phrase that fired. Uses `indexOf` rather than
 * regex — for short needles this is faster and cannot backtrack.
 */
export function countPhrases(
  lower: string,
  lexicon: readonly string[],
): { count: number; matched: string[] } {
  const matched: string[] = [];
  for (const phrase of lexicon) {
    if (lower.includes(phrase)) matched.push(phrase);
  }
  return { count: matched.length, matched };
}

/** Emoji and pictographic symbols, excluding plain text punctuation. */
const EMOJI_MATCH =
  /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{2B00}-\u{2BFF}\u{1F000}-\u{1F0FF}]/gu;

/** Count emoji and pictographic characters in a string. */
export function countEmoji(text: string): number {
  return (text.match(EMOJI_MATCH) ?? []).length;
}

/** Whether a line opens with a bullet glyph or decorative marker. */
export function startsWithBullet(line: string, glyphs: readonly string[]): boolean {
  for (const glyph of glyphs) {
    if (!line.startsWith(glyph)) continue;
    // A bare "-" or "*" only counts as a bullet when followed by a space;
    // otherwise "-5% churn" and "*emphasis*" would read as list items.
    if (glyph.length === 1 && /[-—*]/.test(glyph)) {
      return line.length > 1 && line[1] === " ";
    }
    return true;
  }
  return false;
}

/**
 * Population standard deviation.
 *
 * Used for sentence-length variance: LLM prose has unusually uniform sentence
 * lengths, so *low* variance is the slop signal.
 */
export function stdDev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
  const variance =
    values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

/** Mean of a numeric array; 0 for an empty array. */
export function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/**
 * Map an unbounded count to 0–1, reaching ~0.63 at `scale` and saturating
 * after. Keeps a post with 40 emoji from dominating a post with 8, both of
 * which are already maximally slop-like on that axis.
 */
export function saturate(value: number, scale: number): number {
  if (value <= 0) return 0;
  return 1 - Math.exp(-value / scale);
}

/** Clamp to the 0–1 range. */
export function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/** Safe ratio; returns 0 when the denominator is 0. */
export function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator;
}
