import { hiddenCharCount, readBothSources, recoversHiddenTail } from "./dom-text";
import { authorCandidates, findActorLink, findAuthor } from "./author";
import { isForeignRegion } from "./dom-text";

export { findAuthor } from "./author";

/**
 * Every LinkedIn-specific DOM assumption lives here.
 *
 * LinkedIn's class names are obfuscated and rotate without notice, so selectors
 * are layered: stable `data-*` attributes and ARIA roles first, then structural
 * heuristics. Callers treat a `null` result as "skip this post", never as an
 * error — failing soft keeps the feed usable when LinkedIn ships a redesign.
 */

/** Candidate containers for the feed, most stable first. */
const FEED_ROOTS = [
  "main[aria-label]",
  "main",
  "div.scaffold-finite-scroll__content",
  "#main-content",
];

/** Locate the feed container to observe. Falls back to `document.body`. */
export function findFeedRoot(): HTMLElement {
  for (const selector of FEED_ROOTS) {
    const el = document.querySelector<HTMLElement>(selector);
    if (el) return el;
  }
  return document.body;
}

/**
 * Selectors that identify a post container.
 *
 * `data-urn` and `data-id` carry the post URN and are the most durable signal
 * LinkedIn exposes. The `.feed-shared-update-v2` class has been stable for
 * years but is not guaranteed.
 */
const POST_SELECTOR = [
  "div.feed-shared-update-v2",
  "div[data-urn]",
  "div[data-id]",
  'div[role="article"]',
  // Newer feed markup wraps each post in an <article>, and some variants put
  // the urn on a non-div element, so neither of the above matches. LinkedIn
  // renders each *comment* as an <article> too, which is why this tier never
  // runs while a real post card is on the page, and why what it does match
  // still has to clear the containment test in `looksLikePost`.
  "article",
  "[data-urn]",
  "[data-id^='urn:li:']",
  "div.fie-impression-container",
].join(",");

/**
 * URN types that identify a post, as opposed to something else with a URN.
 *
 * `urn:li:comment:` is the one that matters: a comment's URN is every bit as
 * real as a post's, so a bare "contains urn:li:" check let comments vouch for
 * themselves as posts.
 */
const POST_URN_TYPES = ["activity", "share", "ugcPost", "aggregate"] as const;

/** Attributes LinkedIn writes a URN into. */
const URN_ATTRS = ["data-urn", "data-id", "data-activity-urn"] as const;

/**
 * What a genuine feed post card looks like — the "div box of a post".
 *
 * This is the positive half of the comment problem, and it is the half that
 * works. Excluding comments by class substring (`[class*='comment']`) assumes
 * LinkedIn keeps the word "comment" in a class name it rotates at will; on the
 * live feed it does not, so commenters kept arriving as posts. Requiring the
 * opposite — that an element *be* one of these boxes — does not depend on
 * anything a comment could stop looking like. A comment lives inside a post
 * card and is never one itself, whatever its classes say.
 *
 * The URN prefixes are matched case-insensitively (`i`) because `urn:li:ugcPost`
 * is mixed case and CSS attribute values are case-sensitive by default.
 *
 * Built with `flatMap` rather than string interpolation: interpolating a
 * comma-separated list into a compound selector puts the prefix on only the
 * first alternative, which is how an invalid selector reached the live feed
 * once already.
 */
const POST_CONTAINER = [
  "div.feed-shared-update-v2",
  "div.fie-impression-container",
  "div[data-finite-scroll-hotkey-item]",
  ...URN_ATTRS.flatMap((attr) =>
    POST_URN_TYPES.map((type) => `[${attr}^='urn:li:${type}' i]`),
  ),
].join(",");

/** True when the element is itself a genuine feed post card. */
export function isPostContainer(el: Element): boolean {
  return el.matches(POST_CONTAINER);
}

/** True when the element matches one of the broad post selectors. */
export function isPostElement(el: Element): boolean {
  return el.matches(POST_SELECTOR);
}

/** Links that identify who authored a post. Every post card carries one. */
const AUTHOR_LINK_SELECTOR = 'a[href*="/in/"], a[href*="/company/"]';

/**
 * Text length without forcing layout.
 *
 * `innerText` is layout-dependent — reading it flushes pending style and
 * reflow, and discovery reads it once per ancestor per candidate on every
 * scan. `textContent` needs none of that. It over-counts slightly (it includes
 * text a stylesheet has hidden) but discovery only ever compares the result
 * against coarse thresholds, so the precision is not worth the reflow.
 *
 * Body *extraction* still uses `innerText`, because there the line breaks it
 * infers from block layout are themselves features.
 */
function textLength(el: Element): number {
  return el.textContent?.trim().length ?? 0;
}

/** How many distinct post authors a subtree references. */
function countAuthorLinks(el: Element): number {
  return el.querySelectorAll(AUTHOR_LINK_SELECTOR).length;
}

/**
 * A parent whose children look like a list of posts.
 */
interface ListCandidate {
  parent: HTMLElement;
  items: HTMLElement[];
  /** Combined text of the items — how much of the page this list accounts for. */
  totalChars: number;
  /** Largest item's share of that text. A lopsided group is not a list. */
  topShare: number;
  /** Distance from the feed root. */
  depth: number;
}

/** One post's worth of text. Below this it is a header or a byline. */
const MIN_ITEM_TEXT = 80;

/**
 * Above this the child is a list of posts, not one post in it.
 *
 * Generous, because a popular post carries its comment thread inside the same
 * box and a tight cap would disqualify exactly the posts people argue about.
 */
const MAX_ITEM_TEXT = 8000;

/**
 * Every parent in the subtree that could be the feed list.
 *
 * A *feed item* is a child holding one post's worth of text and at least one
 * profile link; a candidate list is a parent with two or more of them.
 *
 * An item is excluded if it is itself a list container — i.e. it has two or
 * more qualifying direct children of its own. That is the `#chrome` wrapper
 * case: it sees `promoA`, `promoB`, and `#feed` as three qualifying children,
 * but `#feed` is itself the list and dominates the text (topShare ≈ 0.89),
 * which made the wrapper beat the real feed list on totalChars. Dropping items
 * that are sub-lists removes `#feed` from `#chrome`'s group so the wrapper
 * gets fewer than two items and is never emitted as a candidate.
 */
function listCandidates(root: Element): ListCandidate[] {
  const qualifies = (el: Element): number => {
    const length = textLength(el);
    if (length < MIN_ITEM_TEXT || length > MAX_ITEM_TEXT) return 0;
    return el.querySelector(AUTHOR_LINK_SELECTOR) === null ? 0 : length;
  };

  // Grouping the qualifying elements by parent is cheaper than testing every
  // parent, and reaches the same set.
  const groups = new Map<HTMLElement, HTMLElement[]>();
  for (const el of root.querySelectorAll<HTMLElement>("*")) {
    if (qualifies(el) === 0) continue;
    const parent = el.parentElement;
    if (!parent) continue;
    const siblings = groups.get(parent);
    if (siblings) siblings.push(el);
    else groups.set(parent, [el]);
  }

  const candidates: ListCandidate[] = [];
  for (const [parent, items] of groups) {
    if (items.length < 2) continue;

    // Drop items that are themselves list containers: an item that has two or
    // more qualifying direct children is a sub-list, not a post. Including it
    // inflates the wrapper's totalChars and makes the wrapper outrank the real
    // list on the primary sort key.
    const leafItems = items.filter((item) => {
      let qualifyingChildren = 0;
      for (const child of item.children) {
        if (qualifies(child) > 0) {
          qualifyingChildren++;
          if (qualifyingChildren >= 2) return false;
        }
      }
      return true;
    });
    if (leafItems.length < 2) continue;

    const lengths = leafItems.map((item) => textLength(item));
    const totalChars = lengths.reduce((sum, n) => sum + n, 0);
    if (totalChars === 0) continue;

    let depth = 0;
    for (let node = parent.parentElement; node && node !== root; node = node.parentElement) {
      depth++;
    }

    candidates.push({
      parent,
      items: leafItems,
      totalChars,
      topShare: Math.max(...lengths) / totalChars,
      depth,
    });
  }

  return candidates;
}

/**
 * A post card's accessible heading is at most this long.
 *
 * The heading exists for screen readers and names the *kind* of thing the card
 * is ("Feed post"), so it is a couple of words in any locale. A visible heading
 * that happens to lead a card — a section title, a module name — is not
 * necessarily longer, which is why this is a cheap filter and not the test.
 */
const MAX_HEADING_TEXT = 40;

/**
 * Post cards, found by the accessible heading LinkedIn puts at the top of each.
 *
 * **This is the tier that works on the feed shipping now**, and it is here
 * because the two containment tiers either side of it both fail on it:
 * `POST_CONTAINER` matches nothing (every class is hashed, and `data-urn` /
 * `data-id` are gone from the feed entirely), and `findFeedItems` ranks by
 * total text — which on a post's own permalink page hands back the comment
 * thread, because one post plus its thread means the comments always hold more
 * text than the post. That is not a tuning miss; no threshold fixes it.
 *
 * LinkedIn opens every genuine feed card with a visually-hidden `<h2>` reading
 * "Feed post". A comment has no such heading, on any page — which makes this
 * the positive, containment-shaped test the whole file is built around, and the
 * first one since the class rotation that a comment cannot satisfy.
 *
 * **Matched structurally, not by its text.** Requiring the string "Feed post"
 * would be the `[class*='comment']` mistake again in a new costume: an
 * assumption about a string LinkedIn controls, silently returning nothing the
 * moment it changes — and here it would break on every non-English feed, in
 * exactly the way that is hardest to notice, by falling through to the tier
 * that lists commenters. The shape carries the signal on its own: an `h2` that
 * opens a card and says almost nothing is a landmark, not content.
 *
 * **Deliberately layout-free.** The obvious test for "visually hidden" is
 * `getBoundingClientRect().height`, and it is wrong twice: it flushes layout on
 * every heading on every scan, and it is always `0` in jsdom, so a test
 * asserting on it passes without proving anything. The observable facts — the
 * heading opens the card, it is short, the card has real text and an author
 * link — need no layout and mean the same thing. (Measured: the heading renders
 * at `height: 0` in the feed but `height: 1px` on a permalink page, so even the
 * layout-dependent form would have needed a tolerance rather than `=== 0`.)
 *
 * **No upper bound on card text.** `MAX_ITEM_TEXT` exists to stop a list being
 * mistaken for an item, but here the heading has already settled what the
 * element is. A permalink card measured 17 751 characters because it legitimately
 * contains its whole comment thread; capping it at 8 000 would reject the one
 * real post on the page and fall through to the tier that returns ten comments.
 */
function findHeadingCards(root: Element): HTMLElement[] {
  const cards: HTMLElement[] = [];

  for (const heading of root.querySelectorAll<HTMLElement>("h2")) {
    const card = heading.parentElement;
    if (!card) continue;
    // The heading must *open* the card. One in the middle of a body is content.
    if (card.firstElementChild !== heading) continue;
    if (textLength(heading) > MAX_HEADING_TEXT) continue;
    // A card holds a post; the decoy headings LinkedIn ships inside overflow
    // menus ("Ad Options", "Don't want to see this") sit on 10- and 22-character
    // parents and are removed by this floor alone.
    if (textLength(card) < MIN_ITEM_TEXT) continue;
    // Every post card names its author. A module heading's parent does not.
    if (card.querySelector(AUTHOR_LINK_SELECTOR) === null) continue;
    cards.push(card);
  }

  // A reshare nests a card inside a card; the outer one is the whole post.
  return cards.filter((card) => !cards.some((other) => other !== card && other.contains(card)));
}

/**
 * Derive the post box from the shape of the feed, naming nothing.
 *
 * This is the answer to "only treat it as a post if it lives in a post's box"
 * on a feed where the box has no name. As of the markup shipping now, LinkedIn
 * has hashed every class (`main._9b4b878a`) and dropped `data-urn`/`data-id`
 * from the feed entirely, so `POST_CONTAINER` matches nothing and there is no
 * attribute left to anchor on. The structure, though, is not obfuscated and
 * cannot be: the feed is a list whose children are the posts.
 *
 * Ranking those candidate lists is the entire problem, and two obvious metrics
 * are both wrong:
 *
 * - **Most items** picks a comment thread. A thread of five rendered comments
 *   has more children than a feed of three posts, and every commenter becomes
 *   a post — which is the bug this is here to fix.
 * - **Shallowest** picks a wrapper. Some `<div>` high in `main` has two
 *   post-shaped children of its own, and it beat the real feed list on depth
 *   alone: discovery reported 2 posts on a feed showing six.
 *
 * Total text works because it measures how much of the page the list accounts
 * for. The feed list holds every post on screen; a comment thread holds part
 * of one post; a two-child wrapper holds almost nothing. `topShare` then drops
 * a group whose text is really all one child — that is a wrapper around the
 * list, not the list.
 */
function findFeedItems(root: Element): HTMLElement[] {
  const ranked = rankCandidates(listCandidates(root));
  return ranked[0]?.items ?? [];
}

/**
 * Drop wrapper groups and order the rest best-first.
 *
 * `topShare` catches the remaining lopsided-wrapper cases: a group whose text
 * is almost entirely one child is a container around the list, not the list.
 * `listCandidates` already strips sub-list items (children that are themselves
 * list containers) before computing topShare, so the threshold only needs to
 * cover genuine single-dominant-child groups — raised to 0.95 so a feed whose
 * one viral post (e.g. 3 000 ch) dwarfs two short posts (100 ch each, giving
 * topShare ≈ 0.94) is not dropped as lopsided.
 */
function rankCandidates(candidates: ListCandidate[]): ListCandidate[] {
  return candidates
    .filter((c) => c.topShare <= 0.95)
    .sort((a, b) => b.totalChars - a.totalChars || a.depth - b.depth);
}

/**
 * Find posts by feed shape rather than by class name.
 *
 * Anchors on the author link every post card carries, then walks up to the
 * largest ancestor that still describes a *single* post. It is a last resort —
 * imprecise, and it will occasionally pick up a sidebar module — but it
 * degrades gracefully instead of showing nothing at all when LinkedIn ships
 * markup we have never seen.
 *
 * The author-link count is what bounds the walk, and it has to be. Bounding it
 * on text length alone means the walk keeps climbing as long as the total stays
 * under the cap, so three 1200-character posts — comfortably under any cap set
 * for a single post — merge into one container and score as one post. That was
 * the original "badge over the whole feed" bug: anchoring on the author link
 * fixed where the walk *started* without changing where it *stopped*. A second
 * actor link means a second post, so that is the real boundary.
 */
function findPostsByStructure(scope: Element): HTMLElement[] {
  /** A post is at least this many characters of text. */
  const MIN_TEXT = 80;
  /** Above this, the element is a feed or page section, not a single post. */
  const MAX_TEXT = 6000;

  const posts: HTMLElement[] = [];
  const authorLinks = scope.querySelectorAll<HTMLElement>(AUTHOR_LINK_SELECTOR);

  for (const link of authorLinks) {
    // A commenter's link is an author link too, and walking up from one finds
    // the comment — which then scores as though it were a post.
    if (isForeignRegion(link)) continue;
    // Structural discovery only runs when no post card was recognised at all,
    // so a link that *is* inside one belongs to a card this path has no
    // business re-deriving.
    if (link.closest(POST_CONTAINER)) continue;

    let node: HTMLElement | null = link;
    let candidate: HTMLElement | null = null;

    /**
     * How many author links one post is allowed to contain, learned from the
     * markup rather than assumed.
     *
     * A fixed cap cannot work in either direction. Allow one link and a post
     * that @-mentions someone is cut short; allow three and a feed of exactly
     * three posts slips through whole — which is how the merge bug survived a
     * cap in the first place. So the budget is read off the first post-sized
     * ancestor: whatever that box contains is what one post looks like here,
     * mentions included. The moment a larger ancestor exceeds it, that ancestor
     * has reached into a neighbouring post.
     */
    let budget = -1;

    for (let depth = 0; node && node !== document.body && depth < 12; depth++) {
      const length = textLength(node);
      if (length > MAX_TEXT) break;

      if (length >= MIN_TEXT) {
        const authors = countAuthorLinks(node);
        if (budget < 0) budget = Math.max(1, authors);
        if (authors > budget) break;
        candidate = node;
      }

      node = node.parentElement;
    }

    if (candidate && !posts.includes(candidate)) posts.push(candidate);
  }

  // Overlapping candidates are the same post reached from different anchors,
  // and the smallest one is the honest answer. Anchoring on a profile link that
  // is not a post author's — one in the nav, one in a sidebar module — walks up
  // to some wrapper that swallows a real post, and that wrapper is exactly the
  // "one badge over the whole feed" shape. A candidate containing another
  // candidate is therefore never the post.
  return posts.filter((post) => !posts.some((other) => other !== post && post.contains(other)));
}

/**
 * Whether an element plausibly *is* one post, rather than a page module that
 * happens to match a post selector.
 *
 * `POST_SELECTOR` has to be broad to survive class-name rotation, so it also
 * matches ads, "people you may know", notification cards and sidebar modules.
 * Letting those through does not produce wrong verdicts — they fail extraction
 * and are dropped — but it buries the real failures: every one of them lands in
 * the skipped counter, so a perfectly healthy feed reports dozens of skips and
 * `report()` concludes the body selectors are stale.
 */
export function looksLikePost(el: Element): boolean {
  // Whatever it is, it is not one post if it is the size of a page section.
  if (textLength(el) > 6000) return false;

  // A comment carries an author link, a body and often its own URN, so it
  // satisfies every test below. Only its position rules it out.
  if (isForeignRegion(el)) return false;

  // The positive form of the same rule, and the one that survives LinkedIn's
  // class rotation: if this element sits *inside* a post card without being
  // that card, it is part of a post, not a post. Every comment in a thread is
  // exactly that — which is why they kept appearing in the panel as their own
  // rows even after the class-substring blocklist above was widened.
  const container = el.closest(POST_CONTAINER);
  if (container !== null && container !== el) return false;

  // A post URN on the element itself is LinkedIn stating what this is, and
  // outranks every heuristic below — including the text floor. A card that is
  // still hydrating has its actor block and no body yet, which puts it under
  // any sensible floor; rejecting it here would make it undiscoverable at
  // exactly the moment discovery matters, which is the bug this file is
  // supposed to be fixing. Extraction rejects it a moment later if it really
  // is empty, and the observer retries it until it is not.
  //
  // Deliberately not `readUrn`, which also searches descendants — by that
  // measure the feed container carries a URN too.
  if (hasOwnUrn(el)) return true;

  // No URN: the element matched one of the generic selectors, so it has to
  // earn it. An author link is what separates a post from an ad or a sidebar
  // module, and more than a few means it has swallowed a neighbour.
  if (textLength(el) < 80) return false;
  const authors = countAuthorLinks(el);
  return authors >= 1 && authors <= 3;
}

/** The first URN type named in a string. */
const URN_TYPE = /urn:li:([a-zA-Z]+)/;

/**
 * Whether the element's own attributes carry a *post* URN.
 *
 * Only the first URN type in the value counts. A comment's URN is
 * `urn:li:comment:(urn:li:activity:123,456)` — it embeds the activity URN of
 * the post it is attached to, so any check that merely looks for "activity"
 * somewhere in the string lets every comment vouch for itself as a post.
 */
function hasOwnUrn(el: Element): boolean {
  const postTypes = new Set<string>(POST_URN_TYPES.map((t) => t.toLowerCase()));
  for (const attr of URN_ATTRS) {
    const value = el.getAttribute(attr);
    const type = value ? URN_TYPE.exec(value)?.[1]?.toLowerCase() : undefined;
    if (type && postTypes.has(type)) return true;
  }
  return false;
}



/**
 * Which discovery tier answered last, for `diagnose()`.
 *
 * `"cards"` and `"structure"` are both containment answers and both keep
 * comments out. `"heuristics"` is the degraded path that cannot.
 */
let lastPath: "cards" | "headings" | "structure" | "heuristics" | "none" = "none";

/**
 * Every genuine post card in a subtree, outermost only.
 *
 * A reshare nests one card inside another and the feed-item wrapper sits above
 * the card, so the same post matches at more than one depth. The outermost
 * match is the whole post; the inner ones are parts of it.
 */
function collectContainers(scope: Element): HTMLElement[] {
  const found = new Set<HTMLElement>();
  if (scope instanceof HTMLElement && isPostContainer(scope)) found.add(scope);
  for (const el of scope.querySelectorAll<HTMLElement>(POST_CONTAINER)) found.add(el);

  return [...found].filter((el) => {
    const parent = el.parentElement?.closest(POST_CONTAINER);
    return parent === null || parent === undefined || !found.has(parent as HTMLElement);
  });
}

/**
 * Find all post containers within a subtree, including the root itself.
 *
 * Falls back to searching the whole document when the given root yields
 * nothing. The feed root is a guess, and picking the wrong container means
 * every post is outside the subtree we search — which looks identical to
 * "LinkedIn changed its markup" but is our bug, not theirs.
 */
export function findPosts(root: Element): HTMLElement[] {
  let scope: Element = root;
  if (root !== document.body && root.querySelector(POST_SELECTOR) === null) {
    scope = document.body;
  }

  // Tier 1, and the only tier that runs on a healthy feed: the genuine post
  // cards. When LinkedIn is shipping markup we recognise, discovery is a
  // containment question with one answer, and none of the heuristics below —
  // author links, text floors, class substrings — get a say. That is the point:
  // every one of them says yes to a comment.
  const containers = collectContainers(scope);
  if (containers.length > 0) {
    lastPath = "cards";
    return containers;
  }

  // Tier 2, and the one that answers on the feed shipping now: the accessible
  // heading that opens every genuine post card. Still a containment answer, and
  // still one a comment cannot satisfy — a comment has no such heading — but it
  // reads a landmark rather than a class name that no longer exists.
  //
  // Ahead of `findFeedItems` because that tier ranks by total text, which is
  // decided wrongly on any page holding one post and its thread: the comments
  // hold more text than the post, so the thread wins and every commenter is
  // listed as a post. Measured on a permalink page: 10 items returned, all ten
  // of them comments, zero posts.
  const headed = findHeadingCards(scope);
  if (headed.length > 0) {
    lastPath = "headings";
    return headed;
  }

  // Tier 3: no heading either, so derive the box from the shape of the list.
  // Still a containment answer — just one that reads the structure instead of
  // trusting a class name to still exist.
  const items = findFeedItems(scope);
  if (items.length > 0) {
    lastPath = "structure";
    return items;
  }

  // Nothing matched anywhere: fall back to structural discovery, which depends
  // on the shape of the feed rather than on any class name.
  if (scope.querySelector(POST_SELECTOR) === null) {
    lastPath = "heuristics";
    return findPostsByStructure(scope);
  }

  const found = new Set<HTMLElement>();
  if (scope instanceof HTMLElement && isPostElement(scope) && looksLikePost(scope)) {
    found.add(scope);
  }
  for (const el of scope.querySelectorAll<HTMLElement>(POST_SELECTOR)) {
    // A post matching several selectors, or nested inside a reshare, would be
    // added twice; the Set and the outermost-wins filter below prevent that.
    // `looksLikePost` drops the ads and sidebar modules the broad selector list
    // also matches, so they never reach extraction and never inflate the skip
    // counters that `report()` reasons about.
    if (looksLikePost(el)) found.add(el);
  }

  const posts = [...found].filter((el) => {
    // Drop posts nested inside another matched post (reshare inner cards).
    const parent = el.parentElement?.closest(POST_SELECTOR);
    return !parent || !found.has(parent as HTMLElement);
  });

  // Every selector match was rejected as not-a-post. That is the same position
  // as no match at all, so take the structural path rather than returning an
  // empty list and reporting a broken feed.
  lastPath = "heuristics";
  return posts.length > 0 ? posts : findPostsByStructure(scope);
}

/** Read the post's URN from whichever attribute carries it. */
export function readUrn(post: HTMLElement): string | null {
  for (const attr of ["data-urn", "data-id", "data-activity-urn"]) {
    const value = post.getAttribute(attr);
    if (value && value.includes("urn:li:")) return value;
  }
  const nested = post.querySelector<HTMLElement>("[data-urn*='urn:li:']");
  return nested?.getAttribute("data-urn") ?? null;
}

/**
 * Last-resort body discovery, used when every known selector misses.
 *
 * Walks the post for the element holding the most text that is not itself a
 * container of other text blocks. This is slower and less precise than a class
 * selector, but it depends on nothing LinkedIn can rename, so it keeps the
 * extension working through a redesign instead of going silent.
 */
export function findBodyByContent(post: HTMLElement): HTMLElement | null {
  /**
   * A post body is at least this long.
   *
   * It was 40, which is shorter than LinkedIn's byline — "Founder @ Rayvanta |
   * Building Outbound Pipelines for B2B Software…" clears 40 comfortably — so
   * on a card whose body had not hydrated yet this fallback returned the
   * headline and the extension scored the poster's job title as their post.
   */
  const MIN_BODY = 80;

  /**
   * The body is the *first* substantial block in the card, not the biggest.
   *
   * Biggest is what this used to take, and on a post with a busy comment
   * thread the biggest link-free block is somebody's comment — which is how a
   * commenter's name ended up on the row, since the author lookup reads the
   * last profile link before the body and a comment drags that landmark to the
   * bottom of the card. Document order has no such failure mode: comments are
   * always below the post they hang off.
   */
  let best: HTMLElement | null = null;
  /** Same search, but over candidates that carry a profile link. */
  let fallback: HTMLElement | null = null;

  // `textContent`, not `innerText`: this runs over every div, span and p in the
  // post and reads each one's children too, so `innerText` here is a layout
  // flush per element per post per scan. It is also the reason this branch was
  // untestable — jsdom implements no `innerText`, so the fallback that the live
  // feed now depends on returned null in every test.
  for (const candidate of post.querySelectorAll<HTMLElement>("div,span,p")) {
    const length = textLength(candidate);
    if (length < MIN_BODY) continue;
    // Anything this long is a container of several posts, not one post's body.
    if (length > 6000) continue;

    // Prefer the innermost element holding the text: a candidate whose child
    // carries nearly the same text is a wrapper, not the body itself.
    const childText = Array.from(candidate.children)
      .map((child) => textLength(child))
      .reduce((max, len) => Math.max(max, len), 0);
    if (childText > length * 0.9) continue;

    // The byline block is the one thing in a post card that reliably looks
    // like a body to a length test, and the one thing that reliably contains
    // the author's profile link. A real body usually contains no link at all,
    // so links are a tie-breaker rather than a disqualifier: a post that
    // @-mentions someone still needs to be readable.
    if (candidate.querySelector(AUTHOR_LINK_SELECTOR) !== null) {
      fallback ??= candidate;
      continue;
    }

    best = candidate;
    break;
  }

  return best ?? fallback;
}

/** Candidate containers for the post body, most specific first. */
const BODY_SELECTORS = [
  "div.feed-shared-update-v2__description-wrapper",
  "div.update-components-text",
  "div.feed-shared-inline-show-more-text",
  "span.break-words",
  // Newer markup variants. `.update-components-update-v2__commentary` is the
  // current wrapper; the attribute selectors survive class-name rotation.
  ".update-components-update-v2__commentary",
  "[class*='update-components-text']",
  "[class*='description-wrapper']",
  "[data-test-id*='main-feed-activity-card__commentary']",
];

/** Find the element holding the post body text. */
export function findBody(post: HTMLElement): HTMLElement | null {
  for (const selector of BODY_SELECTORS) {
    const el = post.querySelector<HTMLElement>(selector);
    if (el && el.textContent && el.textContent.trim().length > 0) return el;
  }
  return findBodyByContent(post);
}

/** The "…see more" button that expands a collapsed post body. */
const SEE_MORE_BUTTON = [
  "button.feed-shared-inline-show-more-text__see-more-less-toggle",
  "button.inline-show-more-text__button",
  "button[aria-label*='see more' i]",
].join(",");

/** Find the expand button for a collapsed post, if the post is collapsed. */
export function findSeeMoreButton(post: HTMLElement): HTMLButtonElement | null {
  const button = post.querySelector<HTMLButtonElement>(SEE_MORE_BUTTON);
  if (!button || button.getAttribute("aria-expanded") === "true") return null;
  return button;
}

/** Selectors for attached media: image, video, document, poll, or article. */
const MEDIA_SELECTOR = [
  ".update-components-image",
  ".update-components-video",
  ".update-components-document",
  ".update-components-poll",
  ".update-components-article",
  ".update-components-linkedin-video",
].join(",");

/** Whether the post carries media of any kind. */
export function hasMedia(post: HTMLElement): boolean {
  return post.querySelector(MEDIA_SELECTOR) !== null;
}

/** Whether the post is a reshare wrapping another post. */
export function isReshare(post: HTMLElement): boolean {
  return post.querySelector(".update-components-mini-update-v2") !== null;
}

/**
 * Report what is actually in the DOM, independent of our selectors.
 *
 * `diagnose` answers "did our selectors match?"; this answers "what was there
 * to match?" — which is the question that matters when LinkedIn has changed its
 * markup and every selector we own returns nothing.
 */
export function probe(): Record<string, unknown> {
  const counts: Record<string, number> = {};
  for (const selector of [
    "div.feed-shared-update-v2",
    "[data-urn]",
    "[data-id]",
    "article",
    '[role="article"]',
    ".fie-impression-container",
    "div[data-finite-scroll-hotkey-item]",
    ".update-components-text",
    ".update-components-actor__title",
    ".feed-shared-inline-show-more-text",
    "main",
    ".scaffold-finite-scroll__content",
  ]) {
    try {
      counts[selector] = document.querySelectorAll(selector).length;
    } catch {
      counts[selector] = -1;
    }
  }

  // Class names on the ancestors of a known post-body element. When our
  // selectors miss, this is what they should have been looking for.
  const bodyish = document.querySelector(
    "[class*='update-components-text'], [class*='commentary'], [class*='description']",
  );
  const ancestry: string[] = [];
  let node: Element | null = bodyish;
  for (let depth = 0; node && depth < 8; depth++) {
    ancestry.push(`${node.tagName.toLowerCase()}.${node.className || "(none)"}`.slice(0, 140));
    node = node.parentElement;
  }

  return { counts, ancestry, url: location.pathname };
}

/**
 * Report what every author source yielded, per post.
 *
 * When a row reads "Unknown author" this says which layers were tried, what raw
 * string each one produced, and why cleaning rejected it — so a failure can be
 * reported rather than guessed at.
 */
export function authorReport(): Record<string, unknown> {
  const posts = findPosts(findFeedRoot());
  const rows = posts.slice(0, 10).map((post) => {
    const body = findBody(post);
    const actor = findActorLink(post, body);
    return {
    resolved: findAuthor(post, body),
    chosenLink: actor?.getAttribute("href")?.slice(0, 80) ?? null,
    actorLinksInCard: post.querySelectorAll(AUTHOR_LINK_SELECTOR).length,
    candidates: authorCandidates(post, body).map((c) => ({
      source: c.source,
      raw: c.raw.slice(0, 90),
      cleaned: c.cleaned,
    })),
  };
  });

  const resolved = rows.filter((r) => r.resolved !== null).length;
  const noCandidates = rows.filter((r) => r.candidates.length === 0).length;

  let verdict: string;
  if (rows.length === 0) {
    verdict = "No posts found, so no authors to read. Run __unslop.report().";
  } else if (resolved === rows.length) {
    verdict = `Working: resolved an author for all ${rows.length} post(s).`;
  } else if (noCandidates === rows.length) {
    verdict =
      `No author source matched on any of ${rows.length} post(s) — no actor ` +
      "class, no profile link, no avatar. Send `rows` and a sample of the " +
      "post markup.";
  } else {
    verdict =
      `Resolved ${resolved} of ${rows.length}. Sources were found but cleaning ` +
      "rejected them — check the `raw` values in `rows` for what came back.";
  }

  console.log(`%c[unslop] ${verdict}`, "font-weight:700");
  return { verdict, rows };
}

/**
 * Describe one element the way a selector would have to match it.
 *
 * Tag, classes and every `data-*` attribute, truncated — enough to write a
 * container selector from, and nothing else.
 */
function describeElement(el: Element): string {
  const attrs = [...el.attributes]
    .filter((a) => a.name.startsWith("data-") || a.name === "role")
    .map((a) => `[${a.name}="${a.value.slice(0, 60)}"]`)
    .join("");
  const classes = (el.getAttribute("class") ?? "").trim().split(/\s+/).filter(Boolean);
  return `${el.tagName.toLowerCase()}${classes.map((c) => "." + c).join("")}${attrs}`.slice(0, 300);
}

/**
 * Print the ancestor chain above a few post bodies and a few comment bodies.
 *
 * This exists because `POST_CONTAINER` was twice written from remembered class
 * names rather than observed ones, and both times it matched nothing on the
 * live feed — which silently drops discovery back to the heuristics that cannot
 * tell a comment from a post. The chain printed here is the ground truth those
 * selectors have to be built from.
 */
export function shapeReport(): Record<string, unknown> {
  const chain = (start: Element | null, depth = 8): string[] => {
    const out: string[] = [];
    let node: Element | null = start;
    for (let i = 0; node && i < depth; i++) {
      out.push(`${i}: ${describeElement(node)}`);
      node = node.parentElement;
    }
    return out;
  };

  // Named selectors are exactly what is missing when this report is worth
  // running, so anchor on what discovery actually returned instead.
  const root = findFeedRoot();
  const posts = findPosts(root).slice(0, 3);
  const containers = document.querySelectorAll(POST_CONTAINER).length;

  // Every list discovery considered, best first, with the numbers it was
  // ranked on. When the wrong one is chosen this says which one it should
  // have been — the difference between a fix and another guess.
  const chosen = findFeedItems(root);
  const candidates = rankCandidates(listCandidates(root))
    .slice(0, 6)
    .map((c) => ({
      chosen: c.items[0] === chosen[0] && c.items.length === chosen.length,
      items: c.items.length,
      totalChars: c.totalChars,
      topShare: Number(c.topShare.toFixed(2)),
      depth: c.depth,
      parent: describeElement(c.parent),
      firstItem: describeElement(c.items[0]!),
      firstItemText: (c.items[0]!.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 120),
    }));

  const report = {
    cardsOnPage: containers,
    feedRoot: describeElement(root),
    containerSelector: POST_CONTAINER,
    candidates,
    posts: posts.map((post) => ({
      self: describeElement(post),
      ancestors: chain(post.parentElement, 5),
      body: findBody(post) ? describeElement(findBody(post)!) : null,
      bodyChars: textLength(post),
    })),
  };

  console.groupCollapsed(
    `%c[unslop] shape — ${containers} recognised post card(s)`,
    "background:#b7791f;color:#fff;font-weight:700;padding:2px 6px;border-radius:3px",
  );
  console.log(report);
  console.groupEnd();
  return report;
}

/**
 * Answer one question about the live feed: when LinkedIn collapses a long post
 * behind "…see more", is the rest of the text still in the DOM?
 *
 * It decides whether expanding a post needs a click at all. If LinkedIn clamps
 * with CSS, the full text is in the markup and only the painting is clipped, so
 * it can be read directly — no click, nothing mutated in the user's feed. If
 * LinkedIn swaps in a shortened text node instead, the text is genuinely gone
 * and a click is the only way to get it.
 *
 * Both are plausible and LinkedIn has shipped both over the years, so this
 * measures rather than assumes. Run it with a few long posts on screen.
 */
export function truncationReport(): Record<string, unknown> {
  const posts = findPosts(findFeedRoot());
  const rows: Record<string, unknown>[] = [];

  for (const post of posts.slice(0, 15)) {
    const body = findBody(post);
    if (!body) continue;

    const sources = readBothSources(body);
    const hidden = hiddenCharCount(sources);
    const collapsed = findSeeMoreButton(post) !== null;
    const rendered = sources.rendered.replace(/\s+/g, " ").trim();
    const markup = sources.markup.replace(/\s+/g, " ").trim();

    rows.push({
      collapsed,
      renderedChars: rendered.length,
      markupChars: markup.length,
      hidden,
      recovers: recoversHiddenTail(sources, 40),
      renderedTail: rendered.slice(-70),
      markupTail: markup.slice(-70),
    });
  }

  const collapsedRows = rows.filter((r) => r["collapsed"] === true);
  const gains = collapsedRows.map((r) => Number(r["hidden"] ?? 0));
  const recovered = collapsedRows.filter((r) => r["recovers"] === true).length;

  // A post that is *not* collapsed should read identically both ways. If the
  // markup is meaningfully longer on those, this walk is picking up chrome that
  // `innerText` correctly leaves out — which would mean the exclusion list in
  // dom-text.ts is missing something LinkedIn ships. Worth knowing, because it
  // is otherwise invisible and quietly feeds junk to the scorer.
  const openRows = rows.filter((r) => r["collapsed"] !== true);
  const contaminated = openRows.filter((r) => Number(r["hidden"] ?? 0) > 40).length;

  let verdict: string;
  if (rows.length === 0) {
    verdict = "No readable post bodies on screen. Scroll the feed and re-run.";
  } else if (collapsedRows.length === 0) {
    verdict =
      `${rows.length} post(s) read, none collapsed behind "…see more". ` +
      "Scroll to a long post and re-run — this needs a collapsed one to measure.";
  } else if (recovered === collapsedRows.length) {
    verdict =
      `The full text IS in the DOM. All ${collapsedRows.length} collapsed ` +
      `post(s) carry more text in the markup than is rendered (median ` +
      `+${median(gains)} chars). Reading the markup recovers it; no click needed.`;
  } else if (recovered === 0) {
    verdict =
      `The text is genuinely truncated in the DOM. None of the ` +
      `${collapsedRows.length} collapsed post(s) hold hidden text, so a click ` +
      "is the only way to expand them.";
  } else {
    verdict =
      `Mixed: ${recovered} of ${collapsedRows.length} collapsed post(s) carry ` +
      "the full text in the markup. LinkedIn is using more than one collapse " +
      "mechanism — the extractor already prefers whichever source has more.";
  }

  if (contaminated > 0) {
    verdict +=
      ` — but note ${contaminated} of ${openRows.length} *uncollapsed* post(s) ` +
      "also read longer from the markup, which means the walk is picking up " +
      "page chrome. Send a `rows` entry where `collapsed` is false.";
  }

  console.log(`%c[unslop] ${verdict}`, "font-weight:700");
  return { verdict, collapsed: collapsedRows.length, contaminated, rows };
}

/** Median of a numeric list, rounded. 0 for an empty list. */
function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return Math.round(
    sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!,
  );
}

/**
 * Report what the selectors can and cannot see on the current page.
 *
 * Exposed through `__unslop.diagnose()`. When LinkedIn changes its markup the
 * symptom is silence — posts are skipped rather than erroring — so this exists
 * to turn that silence into a specific answer about which layer failed.
 */
export function diagnose(): Record<string, unknown> {
  const root = findFeedRoot();
  const posts = findPosts(root);

  const containers = document.querySelectorAll(POST_CONTAINER).length;

  const sample = posts.slice(0, 5).map((post) => ({
    urn: readUrn(post),
    isCard: isPostContainer(post),
    hasBody: findBody(post) !== null,
    bodyChars: findBody(post)?.innerText?.trim().length ?? 0,
    author: findAuthor(post, findBody(post)),
    classes: post.className.slice(0, 120),
  }));

  return {
    feedRoot: `${root.tagName.toLowerCase()}${root.className ? "." + root.className.split(/\s+/)[0] : ""}`,
    // How discovery answered. "cards" is a named container, "headings" is the
    // accessible heading that opens each card, "structure" is a container
    // derived from the shape of the list — all three are containment and all
    // three keep comments out. "heuristics" is the degraded path that cannot,
    // and means no containment test found anything to hold on to.
    path: lastPath,
    cardsOnPage: containers,
    // Headings seen versus headings accepted as cards. A large gap means the
    // filters are rejecting real posts; zero seen on a feed page means
    // LinkedIn dropped the landmark and this tier is no longer load-bearing.
    headingsOnPage: root.querySelectorAll("h2").length,
    headingCards: findHeadingCards(root).length,
    postsFound: posts.length,
    withBody: posts.filter((p) => findBody(p) !== null).length,
    sample,
  };
}

/** Outbound links in the post body, excluding LinkedIn's own internal links. */
export function readLinks(body: HTMLElement): string[] {
  const urls = new Set<string>();
  for (const anchor of body.querySelectorAll<HTMLAnchorElement>("a[href]")) {
    const href = anchor.href;
    if (!href.startsWith("http")) continue;
    // Hashtag and mention links point back into LinkedIn and carry no
    // informational value, so they are not counted as citations.
    if (/^https:\/\/(?:www\.)?linkedin\.com\//.test(href)) continue;
    urls.add(href);
  }
  return [...urls];
}

/**
 * Every CSS selector this module passes to `querySelector`.
 *
 * Exported so `selector-validity.test.ts` can parse each one with a
 * spec-compliant parser rather than jsdom's, which accepts selectors Chrome
 * rejects with a `SyntaxError`.
 */
export const DOM_SELECTORS: readonly string[] = [
  ...FEED_ROOTS,
  POST_SELECTOR,
  POST_CONTAINER,
  AUTHOR_LINK_SELECTOR,
  ...BODY_SELECTORS,
  SEE_MORE_BUTTON,
  MEDIA_SELECTOR,
  "div,span,p",
  "a[href]",
  "[data-urn*='urn:li:']",
  ".update-components-mini-update-v2",
  "[class*='update-components-text'], [class*='commentary'], [class*='description']",
];
