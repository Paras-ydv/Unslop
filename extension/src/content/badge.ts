/**
 * Badge rendering: injects the verdict indicator into a post.
 *
 * Everything lives inside a Shadow DOM so LinkedIn's stylesheet cannot reach
 * in and ours cannot leak out. The host page ships aggressive global rules for
 * `button`, `span`, and `div`, and this is the only reliable way to opt out.
 */

import type { Signal, Verdict } from "@shared/types";
import { type ScoredPost, summarize, verdictLabel } from "../lib/scoring/scorer";

/** Marks a post that already carries a badge. */
export const BADGE_ATTR = "data-unslop-badged";

const PALETTE: Record<Verdict, { dot: string; text: string; bg: string; border: string }> = {
  green: { dot: "#1a7f37", text: "#0f5223", bg: "#eaf6ec", border: "#b7e0c0" },
  yellow: { dot: "#bf8700", text: "#7a5600", bg: "#fdf6e3", border: "#f0dca4" },
  red: { dot: "#c4351b", text: "#8a2415", bg: "#fdedea", border: "#f5c2b8" },
};

/**
 * Styles for the badge's shadow root.
 *
 * Colors are literal rather than tokenized: the shadow root has no access to
 * page variables, and the badge must stay legible against LinkedIn's own light
 * and dark themes, which it cannot detect from inside the shadow boundary.
 */
const STYLES = `
  :host { all: initial; display: block; margin: 8px 0 4px; }
  * { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont,
      "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }

  .bar {
    display: flex; align-items: center; gap: 8px;
    padding: 6px 10px; border-radius: 8px;
    border: 1px solid var(--border); background: var(--bg);
    font-size: 13px; line-height: 1.4; color: var(--text);
  }
  .dot {
    width: 9px; height: 9px; border-radius: 50%;
    background: var(--dot); flex: 0 0 auto;
  }
  .verdict { font-weight: 600; }
  .reason {
    color: var(--text); opacity: 0.85;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    flex: 1 1 auto; min-width: 0;
  }
  .why {
    flex: 0 0 auto; cursor: pointer; border: 1px solid var(--border);
    background: transparent; color: var(--text);
    font-size: 12px; font-weight: 600;
    padding: 2px 8px; border-radius: 6px;
  }
  .why:hover { background: rgba(0, 0, 0, 0.04); }
  .why:focus-visible { outline: 2px solid var(--dot); outline-offset: 1px; }

  .panel {
    margin-top: 6px; padding: 10px 12px;
    border: 1px solid var(--border); border-radius: 8px;
    background: var(--bg); font-size: 12.5px; color: var(--text);
  }
  .panel h4 {
    margin: 0 0 8px; font-size: 11px; text-transform: uppercase;
    letter-spacing: 0.04em; opacity: 0.7; font-weight: 700;
  }
  ul { margin: 0; padding: 0; list-style: none; }
  li { display: flex; align-items: baseline; gap: 8px; padding: 3px 0; }
  .sign { font-weight: 700; flex: 0 0 auto; width: 1em; }
  .sign.up { color: #c4351b; }
  .sign.down { color: #1a7f37; }
  .meta {
    margin-top: 8px; padding-top: 8px;
    border-top: 1px solid var(--border);
    opacity: 0.7; font-size: 11.5px;
  }

  @media (prefers-color-scheme: dark) {
    .bar, .panel { background: rgba(255, 255, 255, 0.04); }
    .why:hover { background: rgba(255, 255, 255, 0.08); }
  }
`;

/** Render one signal as a list item. */
function signalItem(signal: Signal): HTMLLIElement {
  const li = document.createElement("li");

  const sign = document.createElement("span");
  const pushesToSlop = signal.weight > 0;
  sign.className = `sign ${pushesToSlop ? "up" : "down"}`;
  sign.textContent = pushesToSlop ? "▲" : "▼";
  sign.setAttribute(
    "aria-label",
    pushesToSlop ? "lowers quality" : "raises quality",
  );

  const label = document.createElement("span");
  label.textContent = signal.label;

  li.append(sign, label);
  return li;
}

/** Build the expandable explanation panel. */
function buildPanel(scored: ScoredPost): HTMLElement {
  const panel = document.createElement("div");
  panel.className = "panel";
  panel.hidden = true;

  const heading = document.createElement("h4");
  heading.textContent = "What this is based on";
  panel.append(heading);

  const list = document.createElement("ul");
  for (const signal of scored.signals) list.append(signalItem(signal));
  panel.append(list);

  const meta = document.createElement("div");
  meta.className = "meta";
  const parts = [`score ${scored.score.toFixed(2)}`];
  if (scored.uncertain) parts.push("borderline");
  meta.textContent = parts.join(" · ");
  panel.append(meta);

  return panel;
}

/**
 * Attach a badge to a post element.
 *
 * Returns silently if the post is already badged, so a re-render or a repeated
 * scan cannot stack duplicates.
 */
export function renderBadge(post: HTMLElement, scored: ScoredPost): void {
  if (post.hasAttribute(BADGE_ATTR)) return;
  post.setAttribute(BADGE_ATTR, scored.verdict);

  const host = document.createElement("div");
  host.setAttribute("data-unslop-badge", "");
  const root = host.attachShadow({ mode: "open" });

  const style = document.createElement("style");
  style.textContent = STYLES;
  root.append(style);

  const palette = PALETTE[scored.verdict];
  const wrapper = document.createElement("div");
  wrapper.style.setProperty("--dot", palette.dot);
  wrapper.style.setProperty("--text", palette.text);
  wrapper.style.setProperty("--bg", palette.bg);
  wrapper.style.setProperty("--border", palette.border);

  const bar = document.createElement("div");
  bar.className = "bar";

  const dot = document.createElement("span");
  dot.className = "dot";

  const verdict = document.createElement("span");
  verdict.className = "verdict";
  verdict.textContent = verdictLabel(scored.verdict);

  const reason = document.createElement("span");
  reason.className = "reason";
  reason.textContent = summarize(scored);

  const why = document.createElement("button");
  why.className = "why";
  why.type = "button";
  why.textContent = "Why?";
  why.setAttribute("aria-expanded", "false");

  bar.append(dot, verdict, reason, why);

  const panel = buildPanel(scored);
  why.addEventListener("click", () => {
    const open = !panel.hidden;
    panel.hidden = open;
    why.setAttribute("aria-expanded", String(!open));
  });

  wrapper.append(bar, panel);
  root.append(wrapper);

  // Insert above the post body so the verdict is visible before the content is
  // read, which is the whole point — the badge should inform the decision to
  // read, not annotate it afterwards.
  post.prepend(host);
}

/** Remove any badge from a post, so it can be re-rendered. */
export function clearBadge(post: HTMLElement): void {
  post.removeAttribute(BADGE_ATTR);
  post.querySelector(":scope > [data-unslop-badge]")?.remove();
}
