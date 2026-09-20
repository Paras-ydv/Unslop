/** Turns a LinkedIn post element into a structured, normalized `ExtractedPost`. */

import type { ExtractedPost } from "@shared/types";
import { normalizeText, stripSeeMore } from "../lib/normalize";
import { readBothSources, recoversHiddenTail } from "./dom-text";
import {
  findAuthor,
  findBody,
  findBodyByContent,
  findSeeMoreButton,
  hasMedia,
  isReshare,
  readLinks,
  readUrn,
} from "./selectors";

/**
 * Posts shorter than this are almost certainly chrome, not content.
 *
 * Briefly raised to 40 to keep "2 comments" out of the label store, and put
 * back: LinkedIn is full of genuinely short posts — "We shipped it. Finally.",
 * "Congratulations! Well deserved.", "We're hiring, DM me" — and a 40-character
 * floor rejected all of them. It was a length rule standing in for a content
 * rule, and it silently dropped a whole class of real posts to catch chrome
 * that `NOT_A_POST` identifies directly.
 *
 * Short *and* not a post is the chrome case, and that is what the content
 * checks below are for. Short alone is just a short post.
 */
export const MIN_TEXT_LENGTH = 12;

/**
 * Text that is not a post, however much of it there is.
 *
 * Every pattern here was found in the first seven rows of real collected
 * labels — the extractor was capturing author bylines, the video player's
 * accessibility markup, and reaction counters, and each had been rated as
 * though it were a post. At 300 rows that is a poisoned dataset nobody can
 * clean up afterwards, because the only way to tell is to re-read every row.
 *
 * Matching on visible English strings is the weakness problem #3 warns about,
 * so this is a last-resort filter *after* the structural checks, never a
 * substitute for them. The video-player block is the exception worth the risk:
 * it is `<track>` UI text that no post would contain, and it is verbatim
 * enough to match reliably.
 */
const NOT_A_POST = [
  // Video player accessibility text, rendered as a caption-settings dialog.
  /\bStream Type\b.*\bLIVE\b/is,
  /\bThis is a modal window\b/i,
  /\bText Edge Style\b/i,
  /\bVideo Player is loading\b/i,
  // Reaction and comment counters scraped as a body.
  /^[^\n]{0,80}\band \d+ others?\b[^\n]{0,40}(reacted|liked)?\s*$/im,
];

/**
 * Does this read as a profile byline rather than a post?
 *
 * LinkedIn headlines — "7M+ Impressions | Content creator | Ghostwriting" —
 * clear any length floor worth having and carry no sentence structure. They
 * were being scored as posts and rated as posts.
 *
 * The test is pipe-separation without sentence punctuation, which is what a
 * headline is and what a post almost never is. A post that genuinely uses
 * pipes will also contain a full stop somewhere, so it survives.
 */
function looksLikeByline(text: string): boolean {
  if (text.includes("\n")) return false;
  const segments = text.split("|");
  if (segments.length < 3) return false;
  // A real sentence ends somewhere. A headline does not.
  if (/[.!?]\s/.test(text)) return false;
  return segments.every((segment) => segment.trim().split(/\s+/).length <= 8);
}

/** Reject anything that is demonstrably not post content. */
export function isPostContent(text: string): boolean {
  if (looksLikeByline(text)) return false;
  return !NOT_A_POST.some((pattern) => pattern.test(text));
}

/**
 * Longer than any single LinkedIn post, which caps out around 3000 characters.
 *
 * A body this large means the element we matched is a feed or page section that
 * has swallowed many posts, and scoring it would produce one meaningless
 * verdict for the whole page. Rejecting it is always right.
 */
export const MAX_TEXT_LENGTH = 6000;

/**
 * Derive a stable id for a post.
 *
 * Prefers the LinkedIn URN. When absent, falls back to a hash of the author and
 * body, which is stable across re-renders of the same post but collides for
 * genuine duplicates — acceptable, since duplicates get the same verdict anyway.
 *
 * The two fields are joined with a NUL, written as `\0` rather than embedded
 * literally. A raw NUL in the source is invisible in an editor and makes both
 * this file and every bundle built from it register as binary, which silently
 * turns off `grep` and collapses `git diff`. The character is deliberate — it
 * cannot appear in an author name, so it cannot be spoofed into a collision.
 */
function derivePostId(urn: string | null, author: string | null, text: string): {
  id: string;
  stable: boolean;
} {
  if (urn) return { id: urn, stable: true };
  return {
    id: `hash:${hashString(`${author ?? ""}\0${idPrefix(text)}`)}`,
    stable: false,
  };
}

/**
 * The slice of body text a fallback id is derived from.
 *
 * Hashing the whole body made one post into two: the collapsed body and the
 * expanded body are different strings, so a post rated before expanding and
 * again after produced two ids, two panel rows, and two contradictory training
 * rows. Real captured labels contained exactly that pair.
 *
 * A post's opening is what does not change when its tail is revealed, so the
 * hash reads a prefix. 200 characters is longer than any collapsed preview —
 * so the same post hashes the same whether or not it has expanded — and far
 * shorter than a full post, so two different posts sharing an opening is the
 * only new collision, which is the same collision the whole-body hash already
 * had for genuine reposts.
 */
const ID_PREFIX_CHARS = 200;

function idPrefix(text: string): string {
  return text.slice(0, ID_PREFIX_CHARS);
}

/** FNV-1a. Not cryptographic — this only needs to be fast and well-distributed. */
function hashString(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

/**
 * Extra characters the markup must hold beyond the rendered text before the
 * markup read is preferred.
 *
 * Small differences are chrome — a stray label, whitespace handled differently
 * by the two paths — not recovered content. This is set well above that noise
 * and well below the length of any real collapsed tail.
 */
const MIN_HIDDEN_GAIN = 40;

/**
 * Expand a collapsed post body by clicking its "see more" button.
 *
 * Only used when reading the markup did *not* recover the text, because the
 * click is close to useless on its own: LinkedIn's expansion is a state update,
 * so the DOM has not re-rendered by the time the body is read on the next line,
 * and nothing re-reads it afterwards. Clicking also visibly expands posts in
 * the user's feed and fires whatever LinkedIn attaches to that handler, so it
 * is not something to do speculatively.
 */
function tryExpand(post: HTMLElement): void {
  const button = findSeeMoreButton(post);
  if (!button) return;
  try {
    button.click();
  } catch {
    // Expansion is best-effort; a failure just means the post stays truncated.
  }
}

/**
 * Extract a post. Returns `null` when the element carries no usable body,
 * which covers ads, job cards, and "people you may know" modules.
 */
export function extractPost(
  post: HTMLElement,
  options: { expand?: boolean } = {},
): ExtractedPost | null {
  const start = performance.now();

  const body = findBody(post);
  if (!body) return null;

  // Read the body both ways and prefer whichever actually holds the post.
  //
  // How LinkedIn collapses a long post decides whether a click is needed at
  // all. If it clamps with CSS, the full text is in the markup and only the
  // painting is clipped — so reading the markup recovers it with no click, no
  // side effect on the user's feed, and no waiting for a re-render. If instead
  // it swaps in a shortened text node, the two reads agree and nothing here
  // changes. `__unslop.truncation()` reports which case a real feed is in.
  const sources = readBothSources(body);
  const recovered = recoversHiddenTail(sources, MIN_HIDDEN_GAIN);
  const rawText =
    recovered || sources.rendered.trim() === "" ? sources.markup : sources.rendered;

  const normalized = normalizeText(rawText);
  const { text, truncated } = stripSeeMore(normalized);

  // Only fall back to the click when the markup had nothing extra to give.
  if (truncated && !recovered && options.expand !== false) tryExpand(post);

  if (text.length < MIN_TEXT_LENGTH) return null;
  if (text.length > MAX_TEXT_LENGTH) return null;
  if (!isPostContent(text)) return null;

  // For author detection, the body element is used as a landmark: only links
  // that appear before it in document order are candidates for the author.
  //
  // `findBody` may fall back to `findBodyByContent`, which can return a fairly
  // broad element (e.g. the whole post content div) — broad enough that comment
  // links inside it come _before_ the end of it, making them "before body" and
  // valid author candidates. A selector-based body is more precise: it points
  // at the text container itself, not a wrapper around it.
  //
  // When all class-name selectors miss (hashed feed), re-run the content
  // search independently to produce the most precise landmark we can get.
  // If that also returns nothing, `findAuthor` gracefully falls back to
  // ancestor search.
  const authorLandmark = findBodyByContent(post) ?? body;
  const author = findAuthor(post, authorLandmark);
  const { id, stable } = derivePostId(readUrn(post), author, text);

  return {
    id,
    idIsStable: stable,
    text,
    rawText,
    author,
    truncated,
    links: readLinks(body),
    hasMedia: hasMedia(post),
    isReshare: isReshare(post),
    extractionMs: performance.now() - start,
  };
}
