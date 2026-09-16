/**
 * Reading a post body out of the DOM, without asking the layout engine.
 *
 * `innerText` returns *rendered* text, which is two problems at once. It forces
 * a style and layout flush on every read, and it is defined in terms of what is
 * on screen — so anything the page has collapsed may or may not come back
 * depending on how it was collapsed. `textContent` has neither problem but
 * throws away every line break, and line structure is a feature here: one
 * sentence per line, emoji bullets and hook spacing are all structural slop
 * signals.
 *
 * So this walks the tree and rebuilds the line breaks from the markup instead
 * of from the layout — block boundaries and `<br>`, which is most of what
 * `innerText` does anyway. It is layout-free, deterministic, and testable
 * outside a browser, and it returns text the page has visually clipped.
 */

/** Tags that start a new line in rendered text. */
const BLOCK_TAGS = new Set([
  "ADDRESS", "ARTICLE", "ASIDE", "BLOCKQUOTE", "DD", "DIV", "DL", "DT",
  "FIELDSET", "FIGCAPTION", "FIGURE", "FOOTER", "FORM", "H1", "H2", "H3",
  "H4", "H5", "H6", "HEADER", "HR", "LI", "MAIN", "NAV", "OL", "P", "PRE",
  "SECTION", "TABLE", "TD", "TH", "TR", "UL",
]);

/**
 * CSS selector that identifies a foreign region by *named* class or URN.
 *
 * LinkedIn still ships these names on many variants of the feed, so they are
 * worth checking as a fast path. The positional fallback below handles the
 * hashed-class case where none of them exist.
 */
const FOREIGN_REGION_SELECTOR = [
  "[class*='comment']",
  "[class*='social-detail']",
  "[class*='social-counts']",
  "[class*='social-activity']",
  "[class*='reactions']",
  "[class*='reaction-']",
  "[data-id*='urn:li:comment']",
  "[data-urn*='urn:li:comment']",
].join(", ");

/**
 * Whether an element is in a region that belongs to somebody other than the
 * post's author — a comment thread, reaction summary, or social-context block.
 *
 * Three different layers need this answer: discovery must not treat a comment
 * as a post, the author lookup must not read a commenter's name, and the body
 * reader must not fold comment text into the scored post. A comment satisfies
 * every structural test for a post — author link, body, often its own URN —
 * so position is what separates them.
 *
 * **Why a function, not a CSS selector.**
 * Class-name selectors only work when LinkedIn keeps the word "comment" in
 * them. On the hashed-class feed (`[class="_Qr4Vb"]`), they match nothing —
 * and the commenters start appearing in the panel as posts. The layout of a
 * post card is, however, stable and un-obfuscatable:
 *
 *   [actor block]   — always before the body
 *   [body]          — the landmark
 *   [action bar]    — buttons: Like, Comment, Repost, Send
 *   [comments]      — always after the body, siblings or descendants of the
 *                     action bar's parent
 *
 * An element that follows the action bar in document order is in the comment
 * region even when it carries no class name we can match.
 *
 * `postRoot` is the enclosing post element; it is optional so callers that
 * cannot supply it (e.g. body-text walking) still get the fast-path check.
 */
export function isForeignRegion(el: Element, postRoot?: Element | null): boolean {
  // Fast path: named class or URN attribute is still present.
  if (el.matches(FOREIGN_REGION_SELECTOR)) return true;
  if (el.closest(FOREIGN_REGION_SELECTOR)) return true;

  // Slow path: position relative to the action bar.
  //
  // The action bar is the first sibling-level block after the body that holds
  // exactly the four primary action buttons. We find it by looking for a
  // container whose direct children include a "Like" or "Comment" button —
  // these labels are stable (they are user-visible text, not a class name) and
  // cannot be in the body or the actor block.
  //
  // Strategy: walk up from `el` to the post root. At each level, check whether
  // the element comes after a sibling that looks like an action bar. If it
  // does, it is in the comment region.
  const root = postRoot ?? null;
  let node: Element | null = el;

  while (node && node !== root && node.parentElement !== null) {
    const parent: Element = node.parentElement!;
    // Does this parent contain a direct-child action bar sibling?
    const actionBar = findActionBar(parent);
    if (actionBar !== null) {
      // If `node` comes after the action bar in document order, it is in the
      // comment region.
      if (
        (actionBar.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
      ) {
        return true;
      }
    }
    node = parent;
  }

  return false;
}

/**
 * The action bar is a direct child of the post card that contains at least two
 * of the primary action buttons (Like / Comment / Repost / Send).
 *
 * It is not the buttons themselves — it is their container, one level above
 * them. We match it by looking for a child `<button>` whose visible text
 * contains one of the stable labels.
 *
 * Exported for `FOREIGN_REGION` backward-compat and the CSS-selector export
 * in selectors.ts.
 */
const ACTION_LABELS = /^(?:like|comment|repost|send|share)$/i;

function findActionBar(container: Element): Element | null {
  for (const child of container.children) {
    // A direct button with one of the labels — LinkedIn sometimes omits the
    // wrapper and puts buttons as direct children of the card.
    if (child.tagName === "BUTTON" && ACTION_LABELS.test(child.textContent?.trim() ?? "")) {
      return container;
    }
    // More common: a div/nav wrapping the buttons.
    for (const btn of child.querySelectorAll("button")) {
      if (ACTION_LABELS.test(btn.textContent?.trim() ?? "")) return child;
    }
  }
  return null;
}

/**
 * Backward-compatible CSS selector string.
 *
 * Code that calls `el.closest(FOREIGN_REGION)` or `el.matches(FOREIGN_REGION)`
 * and does *not* have access to a post root uses this. It is the named-class
 * fast path only; the positional check requires a function call.
 */
export const FOREIGN_REGION = FOREIGN_REGION_SELECTOR;

/** Tags whose text is never post content. */
const SKIP_TAGS = new Set(["BUTTON", "SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "SVG"]);

/**
 * Class names LinkedIn uses for screen-reader-only copies of visible text.
 *
 * These matter more than they look. The actor name is rendered twice — once
 * visible, once for assistive tech — and counting both turns "Ana Ruiz" into
 * "Ana RuizAna Ruiz". `innerText` drops them because they are positioned off
 * screen; walking the markup does not, so they have to be named.
 */
const HIDDEN_CLASS = /(?:^|\s|-)(?:visually-hidden|sr-only|a11y-text|screen-reader)/i;

/** Whether an element's text should be excluded entirely. */
function isExcluded(el: Element): boolean {
  if (SKIP_TAGS.has(el.tagName)) return true;
  // Comment threads and reaction summaries sit inside the post card. If the
  // body element ever resolves broadly enough to include them, their text must
  // still not reach the scorer — a popular post would otherwise be scored on
  // its comments as much as on itself.
  if (el.matches(FOREIGN_REGION)) return true;
  if (el.hasAttribute("hidden")) return true;
  if (el.getAttribute("aria-hidden") === "true" && el.tagName === "BUTTON") return true;

  // `className` is an SVGAnimatedString on SVG elements, so read the attribute.
  const className = el.getAttribute("class") ?? "";
  if (HIDDEN_CLASS.test(className)) return true;

  // Only the inline `display:none` is checked. `getComputedStyle` would be
  // authoritative and would also force the exact style flush this exists to
  // avoid, on every element of every post.
  const inline = (el as HTMLElement).style?.display;
  return inline === "none";
}

/**
 * Read an element's text with line structure intact.
 *
 * Returns text that the page may have visually clipped, because clipping is a
 * paint-time concern and this never consults paint.
 */
export function readBlockText(root: HTMLElement): string {
  const parts: string[] = [];

  const walk = (node: Node): void => {
    if (node.nodeType === Node.TEXT_NODE) {
      parts.push(node.nodeValue ?? "");
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;

    const el = node as Element;
    if (isExcluded(el)) return;

    if (el.tagName === "BR") {
      parts.push("\n");
      return;
    }

    const isBlock = BLOCK_TAGS.has(el.tagName);
    if (isBlock) parts.push("\n");
    for (const child of el.childNodes) walk(child);
    if (isBlock) parts.push("\n");
  };

  for (const child of root.childNodes) walk(child);
  return parts.join("");
}

/** What the two ways of reading a body each yielded. */
export interface TextSources {
  /** Rendered text, as the browser paints it. Empty outside a browser. */
  rendered: string;
  /** Markup text, including anything the page has visually clipped. */
  markup: string;
}

/** Read a body both ways, for comparison. */
export function readBothSources(body: HTMLElement): TextSources {
  return {
    rendered: (body as HTMLElement).innerText ?? "",
    markup: readBlockText(body),
  };
}

/** Collapse whitespace so the two reads can be compared fairly. */
function squash(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** The trailing affordance, which the rendered read carries and the markup does not. */
const SEE_MORE_TAIL = /(?:…|\.\.\.)\s*(?:see\s*)?more\s*$/i;

/**
 * Extra characters the markup holds beyond what is rendered, ignoring
 * whitespace differences between the two.
 */
export function hiddenCharCount(sources: TextSources): number {
  return squash(sources.markup).length - squash(sources.rendered).length;
}

/**
 * Whether the markup holds a genuine *continuation* of the rendered text.
 *
 * "The markup is longer" is not enough on its own to justify using it. Longer
 * can also mean this walk picked up chrome that `innerText` correctly left out
 * — a tracking span, an alternate-language copy, a label with no class name
 * worth matching. Swapping to the markup read in that case would quietly inject
 * junk into the scorer for every post, not just collapsed ones.
 *
 * A real clipped tail has a specific shape: the rendered text is a *prefix* of
 * the markup text, once the "…see more" affordance is stripped. Requiring that
 * means text can only be recovered by appending to what was already visible,
 * never by replacing it.
 */
export function recoversHiddenTail(sources: TextSources, minGain: number): boolean {
  const markup = squash(sources.markup);
  const rendered = squash(sources.rendered).replace(SEE_MORE_TAIL, "").trim();

  if (rendered === "") return markup.length > 0;
  if (markup.length - rendered.length < minGain) return false;
  return markup.startsWith(rendered);
}
