/**
 * Reading the poster's display name.
 *
 * This was four class-name selectors and no fallback, which meant that the
 * moment LinkedIn rotated those classes every row read "Unknown author" — a
 * silent, total failure of the one field the user actually uses to tell posts
 * apart. The body already degrades through three layers; the author now does
 * too.
 *
 * The layers, most to least precise:
 *
 *   1. Known actor-title classes.
 *   2. The actor link's own text — the same `/in/` anchor discovery relies on,
 *      so if a post was found structurally this is guaranteed to exist.
 *   3. The link's `aria-label` ("View Ana Ruiz's profile").
 *   4. The avatar's `alt` ("Ana Ruiz" or "Ana Ruiz's profile photo").
 *   5. The profile slug in the URL. Ugly, but a name-shaped string beats
 *      "Unknown author" for telling one row from another.
 *
 * Cleaning matters as much as finding. Every one of these sources arrives with
 * something attached: a screen-reader duplicate of the name, a headline, a
 * connection degree, a "• Following". The raw string is almost never the name.
 */

import { isForeignRegion, readBlockText } from "./dom-text";

export { FOREIGN_REGION } from "./dom-text";

/** Longest plausible display name. Anything longer is a headline. */
const MAX_NAME = 80;

/** Known containers for the actor's display name, most precise first. */
const AUTHOR_SELECTORS = [
  "span.update-components-actor__title span[aria-hidden='true']",
  ".update-components-actor__title span[aria-hidden='true']",
  "span.update-components-actor__title",
  ".update-components-actor__title",
  "span.feed-shared-actor__name",
  ".update-components-actor__meta a span",
  // Attribute-shaped variants, which survive class rotation.
  "[class*='actor__title']",
  "[class*='actor__name']",
  "[data-test-id*='actor-name']",
];

/** Links that point at a profile, company or school page. */
const ACTOR_LINK_PARTS = [
  'a[href*="/in/"]',
  'a[href*="/company/"]',
  'a[href*="/school/"]',
];

/** Any actor link. */
const ACTOR_LINK = ACTOR_LINK_PARTS.join(", ");

/**
 * The same links, but only where they sit in something that looks like an
 * actor block — either inside one, or carrying the class themselves.
 *
 * Built by distributing over the parts rather than interpolating the joined
 * string. Interpolating a comma-separated list into a compound selector is two
 * bugs at once: only the first alternative gets the prefix, so the rest match
 * any link anywhere; and `[class*='actor']a[...]` puts a type selector after an
 * attribute selector, which is invalid CSS. Chrome rejects that with a
 * `SyntaxError` from `querySelector` — surfacing as a bare DOMException — while
 * jsdom's parser accepts it, so no test caught it.
 */
const ACTOR_BLOCK_LINK = ACTOR_LINK_PARTS.flatMap((part) => [
  `[class*='actor'] ${part}`,
  part.replace(/^a/, "a[class*='actor']"),
]).join(", ");

/**
 * Text that is chrome rather than a name.
 *
 * These appear inside actor blocks and would otherwise be returned verbatim as
 * somebody's name.
 */
const NOT_A_NAME =
  /^(?:follow(?:ing)?|connect|promoted|sponsored|\+\s*follow|see more|view profile|•|·)$/i;

/** Separators after which the headline, degree or timestamp begins. */
const TRAILING_META = /\s*[·•|]\s.*$/s;

/**
 * Connection degree markers, which trail the name with no separator at all.
 *
 * No trailing `\b`: "3rd+" ends on a non-word character, so a word boundary
 * there never matches and the marker survives.
 */
const DEGREE = /\s*[•·]?\s*\b(?:1st|2nd|3rd)\+?\s*$/i;

/**
 * Collapse a name that the markup rendered twice.
 *
 * LinkedIn ships the actor name as a visible copy plus a screen-reader copy.
 * `readBlockText` drops the ones it can identify by class, but not every
 * variant is labelled, so an exact doubling is also unpicked here: "Ana
 * RuizAna Ruiz" and "Ana Ruiz Ana Ruiz" both collapse to "Ana Ruiz".
 */
function undouble(text: string): string {
  // A run of one repeated character is not a doubled name, and halving it
  // repeatedly would shrink any long string under the length check below.
  if (/^(.)\1*$/.test(text)) return text;

  if (text.length % 2 === 0) {
    const half = text.length / 2;
    if (text.slice(0, half) === text.slice(half)) return text.slice(0, half);
  }

  const spaced = text.match(/^(.+?)\s+\1$/);
  if (spaced?.[1]) return spaced[1];

  return text;
}

/**
 * Turn a raw candidate string into a display name, or null if it is not one.
 *
 * Exported for the `__unslop.authors()` diagnostic, which shows what each
 * source yielded before and after cleaning.
 */
export function cleanAuthorName(raw: string): string | null {
  if (!raw) return null;

  // The name is the first line; a headline follows on later ones.
  let name = raw.split("\n").map((line) => line.trim()).find(Boolean) ?? "";

  name = name.replace(/\s+/g, " ").trim();

  // aria-label and alt wrappers: "View Ana Ruiz's profile", "Ana Ruiz's
  // profile photo". The apostrophe may be straight or curly.
  name = name.replace(/^view\s+/i, "");
  name = name.replace(/['’]s\s+(?:profile(?:\s+photo)?|page).*$/i, "");
  name = name.replace(/\s*[-–]\s*profile\s+photo\s*$/i, "");

  name = name.replace(TRAILING_META, "");
  name = undouble(name.trim());
  name = name.replace(DEGREE, "").trim();
  // Undouble again: stripping a degree can expose a doubling that the marker
  // was sitting between ("Ana Ruiz• 3rd+Ana Ruiz" is real markup).
  name = undouble(name).trim();

  if (!name || name.length > MAX_NAME) return null;
  if (NOT_A_NAME.test(name)) return null;
  // A name has at least one letter; "•", "2h", "—" do not qualify.
  if (!/\p{L}/u.test(name)) return null;

  return name;
}

/**
 * Derive a name from a profile URL.
 *
 * Last resort. `/in/ana-ruiz-8b4a21/` yields "Ana Ruiz" — the trailing
 * disambiguation hash LinkedIn appends is dropped, since it is never part of
 * anybody's name.
 */
export function nameFromProfileUrl(href: string): string | null {
  const match = /\/(?:in|company|school)\/([^/?#]+)/.exec(href);
  const slug = match?.[1];
  if (!slug) return null;

  const parts = decodeURIComponent(slug)
    .split("-")
    .filter(Boolean)
    // Drop LinkedIn's trailing id segment: a run that carries digits and is not
    // a word anyone has in their name.
    .filter((part, index, all) => !(index === all.length - 1 && /\d/.test(part)));

  if (parts.length === 0) return null;

  const name = parts
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");

  return cleanAuthorName(name);
}

/**
 * Every CSS selector this module passes to `querySelector`.
 *
 * Exported so `selector-validity.test.ts` can parse each one with a
 * spec-compliant parser. jsdom accepts selectors Chrome rejects, so a selector
 * being exercised by a passing test is not evidence that it is valid.
 */
export const AUTHOR_DOM_SELECTORS: readonly string[] = [
  ...AUTHOR_SELECTORS,
  ...ACTOR_LINK_PARTS,
  ACTOR_LINK,
  ACTOR_BLOCK_LINK,
  "img[alt]",
];

/** One source's contribution, for the diagnostic. */
export interface AuthorCandidate {
  source: string;
  raw: string;
  cleaned: string | null;
}

/**
 * Social-context lines: "Ben Shah commented on this", "Ana Ruiz likes this".
 *
 * These sit *above* the actor block, so the link inside one is the first
 * profile link in the card and gets picked by any "first link wins" rule — and
 * it names a person who did not write the post. Matched on text rather than
 * class because the wording is the stable part; LinkedIn has shipped this block
 * under several class names.
 */
const SOCIAL_CONTEXT =
  /\b(?:commented on|replied to|likes|liked|loves|celebrates|supports|finds|reposted|shared)\b[^.]{0,40}\bthis\b/i;

/** How far up from a link to look for a social-context wrapper. */
const CONTEXT_DEPTH = 4;

/** Whether a link sits in a part of the card that is not the author's. */
function isForeignLink(link: HTMLElement, post: HTMLElement): boolean {
  // Use the full positional check (action-bar boundary + named classes),
  // supplying the post root so the walk knows when to stop.
  if (isForeignRegion(link, post)) return true;

  let node: HTMLElement | null = link.parentElement;
  for (let depth = 0; node && depth < CONTEXT_DEPTH; depth++) {
    if (node === post) break;
    // Only test compact blocks: the whole card contains "likes this" somewhere
    // in its reaction counts, and testing that would reject everything.
    const text = node.textContent ?? "";
    if (text.length <= 160 && SOCIAL_CONTEXT.test(text)) return true;
    node = node.parentElement;
  }
  return false;
}

/**
 * Pick the link that belongs to the post's author.
 *
 * The body is the landmark, and it is the only one that does not depend on a
 * class name surviving. A post card reads, in order:
 *
 *     [social context]  "Ben Shah commented on this"     ← not the author
 *     [actor block]     Ana Ruiz · Staff Engineer · 2h   ← the author
 *     [body]            the post text                    ← mentions live here
 *     [social counts]   "Ana and 12 others"              ← not the author
 *     [comments]        every commenter                  ← not the author
 *
 * So: keep only links that precede the body, drop the ones in social context,
 * and of what remains take the *last* — the one closest to the body. That is
 * the actor block, because social context is the only thing above it.
 *
 * Everything after the body is discarded outright, which is what stops
 * commenters' names being reported as authors.
 */
export function findActorLink(
  post: HTMLElement,
  body: HTMLElement | null,
): HTMLAnchorElement | null {
  const all = [...post.querySelectorAll<HTMLAnchorElement>(ACTOR_LINK)].filter(
    (link) => !isForeignLink(link, post),
  );

  const beforeBody = body
    ? all.filter(
        (link) =>
          (body.compareDocumentPosition(link) & Node.DOCUMENT_POSITION_PRECEDING) !== 0,
      )
    : all;

  // A link inside a named actor block is unambiguous; take it regardless of
  // position. Prefer the last such link, for the reshare case where the
  // original author's actor block is nested inside the resharer's card.
  const inActorBlock = beforeBody.filter((link) => link.closest("[class*='actor']"));
  if (inActorBlock.length > 0) return inActorBlock[0] ?? null;

  // No class survived. Fall back to position alone.
  if (beforeBody.length > 0) return beforeBody[beforeBody.length - 1] ?? null;

  // Nothing before the body. Rather than reach into the comments for a name
  // that is definitely wrong, give up — `null` renders as "Unknown author",
  // which is honest, where a commenter's name is not.
  return null;
}

/** Every author candidate a post offers, in priority order. */
export function authorCandidates(
  post: HTMLElement,
  body: HTMLElement | null = null,
): AuthorCandidate[] {
  const candidates: AuthorCandidate[] = [];

  // Named actor containers first, but only ones that are not themselves inside
  // a comment — `[class*='actor']` matches a commenter's actor block too.
  for (const selector of AUTHOR_SELECTORS) {
    for (const el of post.querySelectorAll<HTMLElement>(selector)) {
      if (isForeignLink(el, post)) continue;
      if (
        body &&
        (body.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_PRECEDING) === 0 &&
        !el.contains(body)
      ) {
        continue;
      }
      const raw = readBlockText(el).trim();
      candidates.push({ source: selector, raw, cleaned: cleanAuthorName(raw) });
      break;
    }
  }

  const link = findActorLink(post, body);

  if (link) {
    const text = readBlockText(link).trim();
    candidates.push({ source: "actor link text", raw: text, cleaned: cleanAuthorName(text) });

    const aria = link.getAttribute("aria-label") ?? "";
    candidates.push({ source: "actor link aria-label", raw: aria, cleaned: cleanAuthorName(aria) });

    const alt = link.querySelector("img[alt]")?.getAttribute("alt") ?? "";
    candidates.push({ source: "avatar alt", raw: alt, cleaned: cleanAuthorName(alt) });

    const href = link.getAttribute("href") ?? "";
    candidates.push({ source: "profile url", raw: href, cleaned: nameFromProfileUrl(href) });
  }

  // When LinkedIn puts the post URN on an inner wrapper, the actor block can
  // sit just above the element we matched. Only an ancestor holding exactly one
  // actor link is used — two means the walk has reached the feed, and the name
  // could belong to a neighbouring post.
  if (!link) {
    let node: HTMLElement | null = post.parentElement;
    for (let depth = 0; node && depth < 4; depth++) {
      const links = [...node.querySelectorAll<HTMLAnchorElement>(ACTOR_LINK)].filter(
        (candidate) => !isForeignLink(candidate, node!),
      );
      if (links.length > 1) break;
      const found = links[0];
      if (found) {
        const text = readBlockText(found).trim();
        candidates.push({ source: "ancestor actor link", raw: text, cleaned: cleanAuthorName(text) });
        const aria = found.getAttribute("aria-label") ?? "";
        candidates.push({ source: "ancestor aria-label", raw: aria, cleaned: cleanAuthorName(aria) });
        const href = found.getAttribute("href") ?? "";
        candidates.push({ source: "ancestor profile url", raw: href, cleaned: nameFromProfileUrl(href) });
        break;
      }
      node = node.parentElement;
    }
  }

  return candidates;
}

/**
 * Read the author's display name, or null when nothing yields one.
 *
 * `body` is the post body element, used as the landmark that separates the
 * author from everyone else on the card. Passing it is strongly preferred; the
 * caller has already found it.
 */
export function findAuthor(
  post: HTMLElement,
  body: HTMLElement | null = null,
): string | null {
  for (const candidate of authorCandidates(post, body)) {
    if (candidate.cleaned) return candidate.cleaned;
  }
  return null;
}
