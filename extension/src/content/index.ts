/**
 * Content script entry point.
 *
 * Observe the feed, extract and score each post, and list the verdict in the
 * panel. Everything runs locally; no network calls.
 */

import type { ExtractedPost } from "@shared/types";
import { readCache, writeCache, cacheSize, clearCache } from "../lib/cache";
import { scorePost, summarize, type ScoredPost } from "../lib/scoring/scorer";
import { listedCount, resetPanel, showPost } from "./panel";
import { FeedObserver } from "./observer";
import { authorReport, diagnose, probe, shapeReport, truncationReport } from "./selectors";

/** Paths where a post feed can appear. */
const FEED_PATHS = [/^\/feed\/?/, /^\/in\//, /^\/company\//, /^\/posts\//, /^\/$/];

function onFeedPage(): boolean {
  return FEED_PATHS.some((pattern) => pattern.test(location.pathname));
}

/** Running totals, for eyeballing the performance budget while dogfooding. */
const stats = {
  posts: 0,
  cacheHits: 0,
  totalMs: 0,
  verdicts: { green: 0, yellow: 0, red: 0 },
};

function handlePost(post: ExtractedPost, element: HTMLElement): void {
  const start = performance.now();

  // A cache hit skips feature extraction and scoring entirely. It used to
  // recompute the feature set anyway — the expensive half — for a consumer that
  // never read it, which made the cache close to free of benefit.
  const cached = post.idIsStable ? readCache(post.id) : null;

  const scored: ScoredPost = cached
    ? {
        postId: post.id,
        verdict: cached.verdict as "green" | "yellow" | "red",
        score: cached.score,
        confidence: cached.confidence,
        signals: cached.signals,
        source: "rules" as const,
        uncertain: cached.uncertain,
      }
    : scorePost(post);

  if (cached) stats.cacheHits += 1;
  else if (post.idIsStable) {
    writeCache(post.id, {
      verdict: scored.verdict,
      score: scored.score,
      confidence: scored.confidence,
      signals: scored.signals,
      uncertain: scored.uncertain,
    });
  }

  showPost(element, post, scored);

  stats.posts += 1;
  stats.totalMs += performance.now() - start;
  stats.verdicts[scored.verdict] += 1;

  console.debug(
    `[unslop] ${scored.verdict.toUpperCase()} ${scored.score.toFixed(2)} ` +
      `${post.author ?? "unknown"} — ${summarize(scored)}`,
  );
}

let observer: FeedObserver | null = null;

function startObserving(): void {
  observer?.stop();
  observer = null;

  if (!onFeedPage()) {
    // Said out loud rather than returning quietly: "no posts listed" and "not a
    // feed page" look identical from the outside, and that ambiguity is the
    // hardest part of diagnosing a silent extension.
    console.info("[unslop] not a feed page, idle at", location.pathname);
    return;
  }

  observer = new FeedObserver({ onPost: handlePost });
  observer.start();

  const found = diagnose();
  console.info("[unslop] observing", location.pathname, found);
  if (found["postsFound"] === 0) {
    console.warn(
      "[unslop] no posts matched yet — this is normal before the feed hydrates. " +
        "Run __unslop.report() after it loads.",
    );
  }
}

/**
 * LinkedIn is a single-page app, so the content script is not re-injected on
 * navigation. Polling `location.href` is crude but robust — it catches
 * pushState, replaceState, and back/forward alike without patching history.
 */
function watchNavigation(): void {
  let lastHref = location.href;
  setInterval(() => {
    if (location.href === lastHref) return;
    lastHref = location.href;
    resetPanel();
    startObserving();
  }, 500);
}

/**
 * Start once the DOM is usable.
 *
 * The script runs at document_end, which is early enough that `document.body`
 * exists but late enough that waiting on DOMContentLoaded costs nothing when it
 * has already fired.
 */
function boot(): void {
  startObserving();
  watchNavigation();

  // Self-diagnose once the feed has had a moment to render.
  //
  // `__unslop` lives in the content script's isolated world, so typing it into
  // the console only works after switching the context dropdown from "top" to
  // this extension — which is not discoverable, and meant the one command that
  // answers "why is this listing comments?" read as `undefined`. A `console.log`
  // from here shows up in the page console regardless of context, so the answer
  // arrives without anyone having to find the dropdown.
  setTimeout(() => {
    const d = diagnose();
    const path = d["path"];
    if (path === "cards" || path === "structure") {
      const how =
        path === "cards"
          ? `${String(d["cardsOnPage"])} named post card(s)`
          : "post boxes derived from the shape of the feed list";
      console.log(
        `%c[unslop] ok%c — ${how}; discovery is using containment, so ` +
          `comments cannot be listed as posts (${String(d["postsFound"])} found)`,
        "background:#22543d;color:#fff;font-weight:700;padding:2px 6px;border-radius:3px",
        "color:inherit",
      );
      // The derived path is right about *what* a post box is and can still be
      // wrong about *which* group of them is the feed — it picked a two-child
      // wrapper once. Printing the candidates it ranked makes that visible
      // without anyone having to reach the isolated-world console.
      if (path === "structure") shapeReport();
      return;
    }
    console.warn(
      `%c[unslop] heuristics%c — neither a named post card nor a feed list ` +
        "could be found, so discovery fell back to walking up from author " +
        "links and comments may be listed as posts. The chains below are what " +
        "the container rules should be built from.",
      "background:#9b2c2c;color:#fff;font-weight:700;padding:2px 6px;border-radius:3px",
      "color:inherit",
    );
    shapeReport();
  }, 4000);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot, { once: true });
} else {
  boot();
}

// Loud, unmissable startup banner. The console on a LinkedIn tab is shared with
// the page and every other extension, and is routinely thousands of lines deep,
// so a plain log is invisible in practice.
console.log(
  "%c[unslop] loaded%c — run __unslop.report() to see what it can find",
  "background:#0a66c2;color:#fff;font-weight:700;padding:2px 6px;border-radius:3px",
  "color:inherit",
);

// Exposed for manual inspection from the devtools console while dogfooding.
Object.assign(globalThis, {
  __unslop: {
    stats: () => ({
      ...stats,
      avgMs: stats.posts > 0 ? stats.totalMs / stats.posts : 0,
      cached: cacheSize(),
      listed: listedCount(),
    }),
    /** Score arbitrary text, for console experimentation. */
    analyze: (text: string) =>
      scorePost({
        id: "manual",
        idIsStable: false,
        text,
        rawText: text,
        author: null,
        truncated: false,
        links: [],
        hasMedia: false,
        isReshare: false,
        extractionMs: 0,
      }),
    clearCache,
    /** Report what the selectors can see, for diagnosing a silent feed. */
    diagnose,
    /** Report what is in the DOM regardless of our selectors. */
    probe,
    shape: shapeReport,
    /**
     * Is a collapsed post's full text still in the DOM, or does it need a
     * click? Run with a few long posts on screen.
     */
    truncation: truncationReport,
    /** Why a row reads "Unknown author": what each author source yielded. */
    authors: authorReport,
    /**
     * One-call health check that says what is wrong in plain language.
     *
     * The raw diagnose/probe output needs interpreting; this does that
     * interpretation so the answer is a sentence, not a table.
     */
    report: () => {
      const found = diagnose();
      const dom = probe();
      const posts = Number(found["postsFound"] ?? 0);
      const bodies = Number(found["withBody"] ?? 0);
      const listed = listedCount();

      const counters = observer?.counters() ?? null;

      let verdict: string;
      if (!onFeedPage()) {
        verdict = `Not a feed page (${location.pathname}). Open linkedin.com/feed/.`;
      } else if (posts === 0) {
        verdict =
          "No post containers matched. LinkedIn's markup has changed — " +
          "send the `dom.counts` and `dom.ancestry` below.";
      } else if (bodies === 0) {
        verdict =
          `Found ${posts} posts but no readable bodies. The body selectors ` +
          "are stale — send `dom.ancestry` below.";
      } else if (listed === 0 && counters && counters.seen === 0) {
        verdict =
          `Found ${posts} posts but none were registered for viewport ` +
          "detection. Discovery is not reaching the observer.";
      } else if (listed === 0 && counters && counters.retrying > 0) {
        verdict =
          `${counters.retrying} post(s) are still waiting for a body to load. ` +
          "This resolves itself; re-run in a few seconds.";
      } else if (listed === 0 && counters && counters.emitted === 0) {
        verdict =
          `Registered ${counters.seen} post(s) but extracted none ` +
          `(${counters.skipped} gave up). Bodies are being rejected — likely ` +
          "too short, or the body element holds no text.";
      } else if (listed === 0) {
        verdict =
          `Extracted ${counters?.emitted ?? 0} post(s) but listed none. ` +
          "The panel is not receiving them.";
      } else {
        verdict = `Working: ${listed} post(s) listed out of ${posts} found.`;
      }

      console.log(`%c[unslop] ${verdict}`, "font-weight:700");
      return { verdict, selectors: found, dom, counters };
    },
    /** Tear down and re-attach the observers, without reloading the page. */
    rescan: () => {
      startObserving();
      return diagnose();
    },
  },
});
