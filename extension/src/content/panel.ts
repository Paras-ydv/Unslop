/**
 * The panel: one persistent overlay listing every post the scorer has seen.
 *
 * This replaces the per-post badge. Injecting a badge into each post meant
 * writing into LinkedIn's own nodes, which is exactly where the feed's
 * virtualisation hurt most — a recycled node kept its "already badged" marker
 * and silently never got another one. One overlay that LinkedIn does not own
 * has no such failure mode, and it survives a feed redesign that would strip an
 * injected child.
 *
 * Everything lives inside a Shadow DOM so LinkedIn's stylesheet cannot reach in
 * and ours cannot leak out.
 *
 * ── Scrolling ──────────────────────────────────────────────────────────────
 * The panel must never interfere with scrolling the feed. Three rules, and all
 * three matter:
 *
 *   1. The host is `position: fixed` and sized to the panel itself, so it
 *      occupies no layout space and intercepts no pointer events outside its
 *      own box. With the cursor anywhere over LinkedIn, the page scrolls
 *      exactly as it did before the extension was installed.
 *   2. Nothing here registers a `wheel`, `touchmove` or `scroll` listener on
 *      the document, and nothing calls `preventDefault`. A non-passive wheel
 *      listener on the document is the usual way an overlay makes a page feel
 *      broken.
 *   3. The list uses `overscroll-behavior: contain`, so scrolling *inside* the
 *      panel stops at its own boundary instead of chaining into the feed.
 *
 * `body { overflow: hidden }` is never set. The page keeps its own scrollbar.
 */

import type { ExtractedPost, Signal, Verdict } from "@shared/types";
import { RATING_SCALE, SCORER_VERSION, saveLabel, toVerdict } from "../lib/labels";
import { type ScoredPost, summarize, verdictLabel } from "../lib/scoring/scorer";

/** Marks the host element, so a re-injection can find and reuse it. */
const HOST_ATTR = "data-unslop-panel";

/** Remembers a dismissal for the life of the tab. */
const DISMISSED_KEY = "unslop:panel-dismissed";

/** Transient outline drawn on a post when its row is clicked. */
const FLASH_ATTR = "data-unslop-flash";

/**
 * Styles for the panel's shadow root.
 *
 * Light and dark are both defined as full token sets. The previous badge
 * swapped only `background` under `prefers-color-scheme: dark` and left the
 * text colours alone, which put dark-on-dark text at ratios between 1.6:1 and
 * 2.3:1 — legible in neither theme's screenshot nor in practice. Every pairing
 * below clears 4.5:1 against its own surface.
 */
const STYLES = `
  :host {
    all: initial;
    position: fixed !important;
    right: 16px !important;
    bottom: 16px !important;
    width: 340px !important;
    max-width: calc(100vw - 32px) !important;
    z-index: 2147483000 !important;
    display: block !important;
    color-scheme: light dark;
  }

  * { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont,
      "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }

  :host {
    --surface: #ffffff;
    --surface-alt: #f6f8fa;
    --text: #1f2328;
    --muted: #57606a;
    --border: #d0d7de;
    --green: #1a7f37;
    --yellow: #8a6300;
    --red: #cf222e;
    --shadow: 0 8px 28px rgba(31, 35, 40, 0.18);
  }

  @media (prefers-color-scheme: dark) {
    :host {
      --surface: #1c2128;
      --surface-alt: #22272e;
      --text: #e6edf3;
      --muted: #9198a1;
      --border: #373e47;
      --green: #57d364;
      --yellow: #e3b341;
      --red: #ff7b72;
      --shadow: 0 8px 28px rgba(1, 4, 9, 0.6);
    }
  }

  .panel {
    display: flex;
    flex-direction: column;
    max-height: min(70vh, 560px);
    background: var(--surface);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: 12px;
    box-shadow: var(--shadow);
    overflow: hidden;
    font-size: 13px;
    line-height: 1.45;
  }

  header {
    display: flex; align-items: center; gap: 8px;
    padding: 10px 10px 10px 12px;
    background: var(--surface-alt);
    border-bottom: 1px solid var(--border);
    flex: 0 0 auto;
  }
  .title { font-weight: 700; font-size: 13px; letter-spacing: -0.01em; }
  .tally { display: flex; gap: 6px; margin-left: auto; }
  .tally b {
    display: inline-flex; align-items: center; gap: 4px;
    font-weight: 600; font-size: 11.5px; color: var(--muted);
  }
  .tally i {
    width: 7px; height: 7px; border-radius: 50%; display: inline-block;
  }

  .close {
    flex: 0 0 auto; cursor: pointer;
    width: 24px; height: 24px; padding: 0;
    display: grid; place-items: center;
    border: 1px solid transparent; border-radius: 6px;
    background: transparent; color: var(--muted);
    font-size: 15px; line-height: 1;
  }
  .close:hover { background: var(--surface); border-color: var(--border); color: var(--text); }
  .close:focus-visible { outline: 2px solid var(--text); outline-offset: 1px; }

  /* Scrolling stops here rather than chaining into the feed behind the panel. */
  .list {
    flex: 1 1 auto;
    overflow-y: auto;
    overscroll-behavior: contain;
    -webkit-overflow-scrolling: touch;
  }
  .list::-webkit-scrollbar { width: 10px; }
  .list::-webkit-scrollbar-thumb {
    background: var(--border); border-radius: 5px;
    border: 3px solid var(--surface);
  }

  .empty { padding: 18px 14px; color: var(--muted); font-size: 12.5px; }

  .row { border-bottom: 1px solid var(--border); }
  .row:last-child { border-bottom: 0; }

  .head {
    display: flex; align-items: flex-start; gap: 8px;
    width: 100%; padding: 9px 12px; text-align: left;
    background: transparent; border: 0; cursor: pointer;
    color: var(--text); font-size: 13px; line-height: 1.45;
  }
  .head:hover { background: var(--surface-alt); }
  .head:focus-visible { outline: 2px solid var(--text); outline-offset: -2px; }

  .dot {
    width: 9px; height: 9px; border-radius: 50%;
    flex: 0 0 auto; margin-top: 5px;
  }
  .dot.green { background: var(--green); }
  .dot.yellow { background: var(--yellow); }
  .dot.red { background: var(--red); }

  .who { flex: 1 1 auto; min-width: 0; }
  .author {
    font-weight: 600; font-size: 12.5px;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .reason {
    color: var(--muted); font-size: 12px;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .flag {
    display: inline-block; margin-left: 6px; padding: 0 5px;
    border: 1px solid var(--border); border-radius: 999px;
    font-size: 10px; font-weight: 600; color: var(--muted);
    vertical-align: 1px;
  }

  .chev {
    flex: 0 0 auto; margin-top: 3px; color: var(--muted);
    font-size: 10px; transition: transform 120ms ease;
  }
  .row[data-open="true"] .chev { transform: rotate(90deg); }

  .detail { padding: 2px 12px 12px 29px; }
  .detail h4 {
    margin: 0 0 6px; font-size: 10.5px; text-transform: uppercase;
    letter-spacing: 0.05em; color: var(--muted); font-weight: 700;
  }
  ul { margin: 0; padding: 0; list-style: none; }
  li { display: flex; align-items: baseline; gap: 7px; padding: 2px 0; font-size: 12px; }
  .sign { font-weight: 700; flex: 0 0 auto; width: 1em; font-size: 9px; }
  .sign.up { color: var(--red); }
  .sign.down { color: var(--green); }

  .meta { margin-top: 8px; font-size: 11px; color: var(--muted); }

  .correct {
    margin-top: 9px; padding-top: 9px;
    border-top: 1px solid var(--border);
    display: flex; align-items: center; gap: 5px; flex-wrap: wrap;
  }
  .correct > span { color: var(--muted); font-size: 11px; width: 100%; }
  .fix {
    cursor: pointer; border: 1px solid var(--border); border-radius: 6px;
    background: var(--surface); color: var(--text);
    font-size: 11px; font-weight: 600; padding: 3px 8px;
  }
  .fix:hover { background: var(--surface-alt); }
  .fix:focus-visible { outline: 2px solid var(--text); outline-offset: 1px; }
  /* Five points need to read as a scale at a glance, so the ends carry the
     verdict colours and the middle stays neutral. Colour is not the only cue:
     the digit, the title and the aria-label all carry the meaning too. */
  .fix.r1 { border-color: var(--green); }
  .fix.r2 { border-color: color-mix(in srgb, var(--green) 55%, var(--border)); }
  .fix.r4 { border-color: color-mix(in srgb, var(--red) 55%, var(--border)); }
  .fix.r5 { border-color: var(--red); }
  .fix[aria-pressed="true"] { background: var(--text); color: var(--surface); }
  .thanks.failed { color: var(--red); font-weight: 700; }
  .fix[aria-pressed="true"] { background: var(--text); color: var(--surface); border-color: var(--text); }
  .thanks { color: var(--muted); font-size: 11px; width: 100%; }

  /* Collapsed state: a small pill that brings the panel back. */
  .reopen {
    cursor: pointer; display: flex; align-items: center; gap: 7px;
    margin-left: auto; padding: 7px 12px;
    background: var(--surface); color: var(--text);
    border: 1px solid var(--border); border-radius: 999px;
    box-shadow: var(--shadow); font-size: 12px; font-weight: 600;
  }
  .reopen:hover { background: var(--surface-alt); }
  .reopen:focus-visible { outline: 2px solid var(--text); outline-offset: 1px; }

  @media (prefers-reduced-motion: reduce) {
    .chev { transition: none; }
  }
`;

/** Injected into the page (not the shadow root) to highlight a located post. */
const FLASH_STYLES = `
  [${FLASH_ATTR}] {
    outline: 2px solid #0a66c2 !important;
    outline-offset: 2px !important;
    border-radius: 8px;
  }
`;

const VERDICT_ORDER: Verdict[] = ["green", "yellow", "red"];

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** Render one signal as a list item. */
function signalItem(signal: Signal): HTMLLIElement {
  const li = el("li");
  const pushesToSlop = signal.weight > 0;

  const sign = el("span", `sign ${pushesToSlop ? "up" : "down"}`, pushesToSlop ? "▲" : "▼");
  sign.setAttribute("aria-label", pushesToSlop ? "lowers quality" : "raises quality");

  li.append(sign, el("span", undefined, signal.label));
  return li;
}

/** One live overlay for the page. */
class Panel {
  private readonly host: HTMLElement;
  private readonly root: ShadowRoot;
  private readonly list: HTMLElement;
  private readonly panel: HTMLElement;
  private readonly tallyNodes: Record<Verdict, HTMLElement>;
  private readonly reopenButton: HTMLButtonElement;
  private readonly counts: Record<Verdict, number> = { green: 0, yellow: 0, red: 0 };
  private readonly rows = new Map<string, HTMLElement>();
  private empty: HTMLElement | null = null;
  private flashTimer: number | null = null;

  constructor() {
    this.host = el("div");
    this.host.setAttribute(HOST_ATTR, "");
    this.root = this.host.attachShadow({ mode: "open" });

    const style = el("style");
    style.textContent = STYLES;
    this.root.append(style);

    this.panel = el("div", "panel");
    this.panel.setAttribute("role", "complementary");
    this.panel.setAttribute("aria-label", "Unslop post quality");

    const header = el("header");
    header.append(el("span", "title", "Unslop"));

    const tally = el("div", "tally");
    this.tallyNodes = {} as Record<Verdict, HTMLElement>;
    for (const verdict of VERDICT_ORDER) {
      const group = el("b");
      const swatch = el("i");
      swatch.style.background = `var(--${verdict})`;
      const count = el("span", undefined, "0");
      group.append(swatch, count);
      group.title = `${verdict} posts`;
      tally.append(group);
      this.tallyNodes[verdict] = count;
    }
    header.append(tally);

    const close = el("button", "close", "✕");
    close.type = "button";
    close.title = "Hide Unslop for this tab";
    close.setAttribute("aria-label", "Hide Unslop for this tab");
    close.addEventListener("click", () => this.dismiss());
    header.append(close);

    this.list = el("div", "list");
    this.list.setAttribute("role", "list");

    this.panel.append(header, this.list);

    this.reopenButton = el("button", "reopen");
    this.reopenButton.type = "button";
    this.reopenButton.hidden = true;
    const pip = el("i");
    pip.style.cssText =
      "width:8px;height:8px;border-radius:50%;background:#0a66c2;display:inline-block";
    this.reopenButton.append(pip, el("span", undefined, "Unslop"));
    this.reopenButton.addEventListener("click", () => this.restore());

    this.root.append(this.panel, this.reopenButton);
    this.renderEmpty();

    this.installFlashStyles();
    document.documentElement.append(this.host);

    if (this.wasDismissed()) this.dismiss({ remember: false });
  }

  /** The outline drawn on a located post has to live in the page, not the shadow. */
  private installFlashStyles(): void {
    if (document.getElementById("unslop-flash-styles")) return;
    const style = el("style");
    style.id = "unslop-flash-styles";
    style.textContent = FLASH_STYLES;
    document.head?.append(style);
  }

  private wasDismissed(): boolean {
    try {
      return sessionStorage.getItem(DISMISSED_KEY) === "1";
    } catch {
      return false;
    }
  }

  private dismiss(options: { remember?: boolean } = {}): void {
    this.panel.style.display = "none";
    this.reopenButton.hidden = false;
    // The host is `width: 340px` for the panel; shrink it so the collapsed pill
    // does not leave a dead 340px-wide strip over the feed.
    this.host.style.setProperty("width", "auto", "important");
    this.host.style.setProperty("display", "flex", "important");

    if (options.remember === false) return;
    try {
      sessionStorage.setItem(DISMISSED_KEY, "1");
    } catch {
      // Dismissal simply does not survive a reload. Not worth failing over.
    }
  }

  private restore(): void {
    this.panel.style.display = "";
    this.reopenButton.hidden = true;
    this.host.style.setProperty("width", "340px", "important");
    this.host.style.setProperty("display", "block", "important");
    try {
      sessionStorage.removeItem(DISMISSED_KEY);
    } catch {
      // Non-fatal.
    }
  }

  private renderEmpty(): void {
    this.empty = el(
      "div",
      "empty",
      "Scroll the feed — posts are scored as they come into view.",
    );
    this.list.append(this.empty);
  }

  /** Scroll the feed to a post and outline it briefly. */
  private locate(element: HTMLElement): void {
    if (!element.isConnected) return;
    element.scrollIntoView({ behavior: "smooth", block: "center" });

    if (this.flashTimer !== null) clearTimeout(this.flashTimer);
    for (const previous of document.querySelectorAll(`[${FLASH_ATTR}]`)) {
      previous.removeAttribute(FLASH_ATTR);
    }
    element.setAttribute(FLASH_ATTR, "");
    this.flashTimer = setTimeout(() => {
      element.removeAttribute(FLASH_ATTR);
      this.flashTimer = null;
    }, 1600) as unknown as number;
  }

  private buildCorrectionRow(post: ExtractedPost, scored: ScoredPost): HTMLElement {
    const row = el("div", "correct");
    row.append(el("span", undefined, "How good was this post, really?"));

    const buttons: HTMLButtonElement[] = [];
    for (const point of RATING_SCALE) {
      // The number leads and the word follows, because the scale is what is
      // being recorded — the words are there so 2 and 4 mean the same thing in
      // month two as in week one, which is the whole risk of a finer scale.
      const button = el("button", `fix r${point.rating}`, `${point.rating}`);
      button.type = "button";
      button.setAttribute("aria-pressed", "false");
      button.title = `${point.label} — ${point.hint}`;
      button.setAttribute("aria-label", `Rate ${point.rating} of 5: ${point.label}. ${point.hint}`);

      button.addEventListener("click", () => {
        for (const other of buttons) other.setAttribute("aria-pressed", "false");
        button.setAttribute("aria-pressed", "true");

        let note = row.querySelector<HTMLElement>(".thanks");
        if (!note) {
          note = el("span", "thanks");
          row.append(note);
        }
        note.textContent = "Saving…";

        // The confirmation waits for the write. Claiming "Saved" before the
        // storage call resolves is how a full quota loses a whole session
        // without anyone noticing.
        void saveLabel({
          postId: post.id,
          text: post.text,
          rating: point.rating,
          label: toVerdict(point.rating),
          predicted: scored.verdict,
          score: scored.score,
          at: new Date().toISOString(),
          scorerVersion: SCORER_VERSION,
        }).then((saved) => {
          note.className = saved ? "thanks" : "thanks failed";
          note.textContent = saved
            ? `Saved: ${point.rating} · ${point.label} ✓`
            : "NOT SAVED — storage failed, see console";
        });
      });

      buttons.push(button);
      row.append(button);
    }

    return row;
  }

  /** Add one scored post to the top of the list. */
  add(post: ExtractedPost, scored: ScoredPost, element: HTMLElement): void {
    if (this.rows.has(post.id)) return;

    if (this.empty) {
      this.empty.remove();
      this.empty = null;
    }

    const row = el("div", "row");
    row.setAttribute("role", "listitem");
    row.dataset["open"] = "false";

    const head = el("button", "head");
    head.type = "button";
    head.setAttribute("aria-expanded", "false");

    head.append(el("span", `dot ${scored.verdict}`));

    const who = el("div", "who");
    const author = el("div", "author", post.author ?? "Unknown author");
    if (post.truncated) {
      // Consumed rather than merely recorded: a post scored on its hook line
      // alone is scored on the most slop-like part of any post, and the reader
      // deserves to know the verdict is provisional.
      const flag = el("span", "flag", "partial");
      flag.title =
        "Scored before the post finished expanding — the verdict is provisional.";
      author.append(flag);
    }
    who.append(author, el("div", "reason", summarize(scored)));
    head.append(who, el("span", "chev", "▶"));

    const detail = el("div", "detail");
    detail.hidden = true;
    detail.append(el("h4", undefined, "What this is based on"));

    const list = el("ul");
    for (const signal of scored.signals) list.append(signalItem(signal));
    detail.append(list);

    const parts = [`${verdictLabel(scored.verdict).toLowerCase()} · score ${scored.score.toFixed(2)}`];
    if (scored.uncertain) parts.push("borderline");
    if (post.truncated) parts.push("provisional — post was truncated");
    detail.append(el("div", "meta", parts.join(" · ")));
    detail.append(this.buildCorrectionRow(post, scored));

    head.addEventListener("click", () => {
      const open = detail.hidden;
      detail.hidden = !open;
      row.dataset["open"] = String(open);
      head.setAttribute("aria-expanded", String(open));
      if (open) this.locate(element);
    });

    row.append(head, detail);
    this.list.prepend(row);
    this.rows.set(post.id, row);

    this.counts[scored.verdict] += 1;
    this.tallyNodes[scored.verdict].textContent = String(this.counts[scored.verdict]);
  }

  /** Drop every row, for an SPA navigation into a different feed. */
  reset(): void {
    this.rows.clear();
    this.list.replaceChildren();
    for (const verdict of VERDICT_ORDER) {
      this.counts[verdict] = 0;
      this.tallyNodes[verdict].textContent = "0";
    }
    this.renderEmpty();
  }

  /** How many posts are listed. */
  size(): number {
    return this.rows.size;
  }
}

let instance: Panel | null = null;

/** The page's panel, created on first use. */
export function getPanel(): Panel {
  if (!instance || !instance_isAttached()) instance = new Panel();
  return instance;
}

/** A SPA route change can replace `document.documentElement`'s children. */
function instance_isAttached(): boolean {
  return document.querySelector(`[${HOST_ATTR}]`) !== null;
}

/** Add a scored post to the panel. */
export function showPost(
  element: HTMLElement,
  post: ExtractedPost,
  scored: ScoredPost,
): void {
  getPanel().add(post, scored, element);
}

/** Number of posts currently listed, for `__unslop.report()`. */
export function listedCount(): number {
  return instance ? instance.size() : 0;
}

/** Clear the list, for an SPA navigation. */
export function resetPanel(): void {
  instance?.reset();
}
