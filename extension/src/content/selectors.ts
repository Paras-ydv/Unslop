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
  // the urn on a non-div element, so neither of the above matches.
  "article",
  "[data-urn]",
  "[data-id^='urn:li:']",
  "div.fie-impression-container",
].join(",");

/** True when the element is itself a post container. */
export function isPostElement(el: Element): boolean {
  return el.matches(POST_SELECTOR);
}

/**
 * Find posts by feed shape rather than by class name.
 *
 * A feed is a container with many similar, text-bearing children. This looks
 * for the element with the most such children and treats those children as
 * posts. It is a last resort — imprecise, and it will occasionally pick up a
 * sidebar module — but it degrades gracefully instead of showing nothing at
 * all when LinkedIn ships markup we have never seen.
 */
function findPostsByStructure(scope: Element): HTMLElement[] {
  /** A post is at least this many characters of text. */
  const MIN_TEXT = 80;
  /** Above this, the element is a feed or page section, not a single post. */
  const MAX_TEXT = 6000;

  const posts: HTMLElement[] = [];

  // Anchor on the author link every post carries. Starting from a marker that
  // only exists inside a post — rather than from "container with the most
  // text-bearing children" — is what keeps this from selecting the feed
  // wrapper and scoring the entire page as one post.
  const authorLinks = scope.querySelectorAll<HTMLElement>(
    'a[href*="/in/"], a[href*="/company/"]',
  );

  for (const link of authorLinks) {
    // Walk up until the element looks like a whole post: enough text to be a
    // body, but not so much that it has swallowed its siblings.
    let node: HTMLElement | null = link;
    let candidate: HTMLElement | null = null;

    for (let depth = 0; node && depth < 12; depth++) {
      const text = node.innerText?.trim().length ?? 0;
      if (text >= MIN_TEXT && text <= MAX_TEXT) candidate = node;
      if (text > MAX_TEXT) break;
      node = node.parentElement;
    }

    if (!candidate) continue;
    // A post already claimed by an earlier link, or containing one, is the
    // same post reached from a different anchor.
    if (posts.some((p) => p === candidate || p.contains(candidate!) || candidate!.contains(p))) {
      continue;
    }
    posts.push(candidate);
  }

  return posts;
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

  // Nothing matched anywhere: fall back to structural discovery, which depends
  // on the shape of the feed rather than on any class name.
  if (scope.querySelector(POST_SELECTOR) === null) {
    return findPostsByStructure(scope);
  }

  const found = new Set<HTMLElement>();
  if (scope instanceof HTMLElement && isPostElement(scope)) found.add(scope);
  for (const el of scope.querySelectorAll<HTMLElement>(POST_SELECTOR)) {
    // A post matching several selectors, or nested inside a reshare, would be
    // added twice; the Set and the outermost-wins filter below prevent that.
    found.add(el);
  }
  return [...found].filter((el) => {
    // Drop posts nested inside another matched post (reshare inner cards).
    const parent = el.parentElement?.closest(POST_SELECTOR);
    return !parent || !found.has(parent as HTMLElement);
  });
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
function findBodyByContent(post: HTMLElement): HTMLElement | null {
  let best: HTMLElement | null = null;
  let bestLength = 0;

  for (const candidate of post.querySelectorAll<HTMLElement>("div,span,p")) {
    const text = candidate.innerText?.trim() ?? "";
    if (text.length < 40) continue;
    // Anything this long is a container of several posts, not one post's body.
    if (text.length > 6000) continue;

    // Prefer the innermost element holding the text: a candidate whose child
    // carries nearly the same text is a wrapper, not the body itself.
    const childText = Array.from(candidate.children)
      .map((child) => (child as HTMLElement).innerText?.trim().length ?? 0)
      .reduce((max, len) => Math.max(max, len), 0);
    if (childText > text.length * 0.9) continue;

    if (text.length > bestLength) {
      best = candidate;
      bestLength = text.length;
    }
  }

  return best;
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

/** Candidate elements holding the author's display name. */
const AUTHOR_SELECTORS = [
  "span.update-components-actor__title span[aria-hidden='true']",
  "span.update-components-actor__title",
  "span.feed-shared-actor__name",
  ".update-components-actor__meta a span",
];

/** Read the author's display name, if present. */
export function findAuthor(post: HTMLElement): string | null {
  for (const selector of AUTHOR_SELECTORS) {
    const text = post.querySelector<HTMLElement>(selector)?.textContent?.trim();
    if (text) return text;
  }
  return null;
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

/** Kept in sync with badge.ts's BADGE_ATTR; duplicated to avoid an import cycle. */
const BADGE_DIAG_ATTR = "data-unslop-badged";

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
 * Report what the selectors can and cannot see on the current page.
 *
 * Exposed through `__unslop.diagnose()`. When LinkedIn changes its markup the
 * symptom is silence — posts are skipped rather than erroring — so this exists
 * to turn that silence into a specific answer about which layer failed.
 */
export function diagnose(): Record<string, unknown> {
  const root = findFeedRoot();
  const posts = findPosts(root);

  const sample = posts.slice(0, 5).map((post) => ({
    urn: readUrn(post),
    hasBody: findBody(post) !== null,
    bodyChars: findBody(post)?.innerText?.trim().length ?? 0,
    author: findAuthor(post),
    classes: post.className.slice(0, 120),
  }));

  return {
    feedRoot: `${root.tagName.toLowerCase()}${root.className ? "." + root.className.split(/\s+/)[0] : ""}`,
    postsFound: posts.length,
    withBody: posts.filter((p) => findBody(p) !== null).length,
    badged: document.querySelectorAll(`[${BADGE_DIAG_ATTR}]`).length,
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
