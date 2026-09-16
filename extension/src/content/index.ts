/**
 * Content script entry point.
 *
 * Phase 2 scope: observe the feed, extract each post, and compute its feature
 * set. Scoring thresholds and the badge UI arrive in phase 3 — for now the
 * features are logged so they can be eyeballed against a real feed.
 */

import type { ExtractedPost } from "@shared/types";
import { extractFeatures, toSignals } from "../lib/features/vector";
import { FeedObserver } from "./observer";

/** Paths where a post feed can appear. */
const FEED_PATHS = [/^\/feed\/?/, /^\/in\//, /^\/company\//, /^\/posts\//, /^\/$/];

function onFeedPage(): boolean {
  return FEED_PATHS.some((pattern) => pattern.test(location.pathname));
}

/** Running totals, for eyeballing the performance budget while dogfooding. */
const stats = { posts: 0, extractMs: 0, featureMs: 0, truncated: 0 };

function handlePost(post: ExtractedPost): void {
  const features = extractFeatures(post);
  const signals = toSignals(features);

  stats.posts += 1;
  stats.extractMs += post.extractionMs;
  stats.featureMs += features.computeMs;
  if (post.truncated) stats.truncated += 1;

  const timing =
    `${post.extractionMs.toFixed(1)}ms extract, ` +
    `${features.computeMs.toFixed(1)}ms features`;

  console.debug(
    `[unslop] #${stats.posts} ${post.author ?? "unknown"} (${timing}` +
      `${post.truncated ? ", truncated" : ""}` +
      `${post.idIsStable ? "" : ", unstable id"})`,
    { text: post.text, signals, features },
  );
}

let observer: FeedObserver | null = null;

function startObserving(): void {
  observer?.stop();
  observer = null;
  if (!onFeedPage()) return;

  observer = new FeedObserver({ onPost: handlePost });
  observer.start();
  console.info("[unslop] observing feed at", location.pathname);
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
      avgExtractMs: stats.posts > 0 ? stats.extractMs / stats.posts : 0,
      avgFeatureMs: stats.posts > 0 ? stats.featureMs / stats.posts : 0,
    }),
    /** Compute features for arbitrary text, for console experimentation. */
    analyze: (text: string) => {
      const features = extractFeatures({
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
      });
      return { features, signals: toSignals(features) };
    },
  },
});
