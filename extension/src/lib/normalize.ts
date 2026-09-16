/**
 * Text normalization for extracted post bodies.
 *
 * Deliberately conservative: emoji, punctuation, casing, and line structure are
 * all signals the feature engine depends on, so none of them are touched here.
 * This only removes invisible characters and collapses incidental whitespace.
 */

/**
 * Zero-width and bidi-control characters. Common in copy-pasted slop.
 *
 * Written with escapes rather than literals on purpose: these characters are
 * invisible in an editor, and a literal one inside a regex breaks the parser.
 */
const INVISIBLE = new RegExp(
  "[\\u00AD\\u200B-\\u200F\\u2028\\u2029\\u202A-\\u202E\\u2060-\\u2064\\uFEFF]",
  "g",
);

/** Runs of spaces and tabs, but not newlines. */
const HORIZONTAL_RUN = /[^\S\r\n]+/g;

/** Three or more newlines, with any horizontal space between them. */
const BLANK_LINE_RUN = /(?:[^\S\r\n]*\r?\n){3,}/g;

/**
 * Normalize a raw post body.
 *
 * Preserves single and double newlines, since one-sentence-per-line layout and
 * hook-line spacing are structural slop signals.
 */
export function normalizeText(raw: string): string {
  return raw
    .normalize("NFC")
    .replace(INVISIBLE, "")
    .replace(/\r\n?/g, "\n")
    .replace(HORIZONTAL_RUN, " ")
    .replace(BLANK_LINE_RUN, "\n\n")
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .trim();
}

/** The trailing affordance LinkedIn appends to collapsed posts. */
const SEE_MORE = /(?:…|\.\.\.)\s*see more\s*$/i;

/** Strip a trailing "…see more" affordance. Returns whether one was present. */
export function stripSeeMore(text: string): { text: string; truncated: boolean } {
  const stripped = text.replace(SEE_MORE, "").trimEnd();
  return { text: stripped, truncated: stripped.length !== text.length };
}
