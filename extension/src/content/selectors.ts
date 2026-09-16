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

/** Find all post containers within a subtree, including the root itself. */
export function findPosts(root: Element): HTMLElement[] {
  const found = new Set<HTMLElement>();
  if (root instanceof HTMLElement && isPostElement(root)) found.add(root);
  for (const el of root.querySelectorAll<HTMLElement>(POST_SELECTOR)) {
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
  return null;
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
