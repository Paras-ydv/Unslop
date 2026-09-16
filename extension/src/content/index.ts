/**
 * Content script entry point.
 *
 * Phase 3 scope: observe the feed, extract and score each post, and render a
 * verdict badge onto it. Everything runs locally; no network calls.
 */

import type { ExtractedPost } from "@shared/types";
import { readCache, writeCache, cacheSize, clearCache } from "../lib/cache";
import { extractFeatures } from "../lib/features/vector";
import { scorePost, summarize } from "../lib/scoring/scorer";
import { renderBadge } from "./badge";
import { FeedObserver } from "./observer";
import { diagnose, probe } from "./selectors";

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

  // A cache hit still needs a badge — the element is new even when the post is
  // not — but it skips feature extraction and scoring entirely.
  const cached = post.idIsStable ? readCache(post.id) : null;

  const scored = cached
    ? {
        postId: post.id,
        verdict: cached.verdict as "green" | "yellow" | "red",
        score: cached.score,
        confidence: cached.confidence,
        signals: cached.signals,
        source: "rules" as const,
        features: extractFeatures(post),
        uncertain: false,
      }
    : scorePost(post);

  if (cached) stats.cacheHits += 1;
  else if (post.idIsStable) {
    writeCache(post.id, {
      verdict: scored.verdict,
      score: scored.score,
      confidence: scored.confidence,
      signals: scored.signals,
    });
  }

  renderBadge(element, post, scored);

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
    // Said out loud rather than returning quietly: "no badges" and "not a feed
    // page" look identical from the outside, and that ambiguity is the hardest
    // part of diagnosing a silent extension.
    console.info("[unslop] not a feed page, idle at", location.pathname);
    return;
  }

  observer = new FeedObserver({ onPost: handlePost });
  observer.start();

  const found = diagnose();
  console.info("[unslop] observing", location.pathname, found);
  if (found["postsFound"] === 0) {
    console.warn(
      "[unslop] no posts matched — LinkedIn's markup may have changed. " +
        "Run __unslop.diagnose() after the feed loads.",
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
    startObserving();
  }, 500);
}

startObserving();
watchNavigation();

// Exposed for manual inspection from the devtools console while dogfooding.
Object.assign(globalThis, {
  __unslop: {
    stats: () => ({
      ...stats,
      avgMs: stats.posts > 0 ? stats.totalMs / stats.posts : 0,
      cached: cacheSize(),
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
    /** Tear down and re-attach the observers, without reloading the page. */
    rescan: () => {
      startObserving();
      return diagnose();
    },
  },
});
