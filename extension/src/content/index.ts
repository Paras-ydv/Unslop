/**
 * Content script entry point.
 *
 * Phase 1 scope: observe the feed and log every extracted post. Scoring and the
 * badge UI arrive in phases 2 and 3.
 */

import type { ExtractedPost } from "@shared/types";
import { FeedObserver } from "./observer";

/** Paths where a post feed can appear. */
const FEED_PATHS = [/^\/feed\/?/, /^\/in\//, /^\/company\//, /^\/posts\//, /^\/$/];

function onFeedPage(): boolean {
  return FEED_PATHS.some((pattern) => pattern.test(location.pathname));
}

/** Running totals, for eyeballing the performance budget while dogfooding. */
const stats = { posts: 0, totalMs: 0, truncated: 0 };

function handlePost(post: ExtractedPost): void {
  stats.posts += 1;
  stats.totalMs += post.extractionMs;
  if (post.truncated) stats.truncated += 1;

  console.debug(
    `[unslop] #${stats.posts} ${post.author ?? "unknown"} ` +
      `(${post.extractionMs.toFixed(1)}ms${post.truncated ? ", truncated" : ""}` +
      `${post.idIsStable ? "" : ", unstable id"})`,
    post.text,
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
      avgMs: stats.posts > 0 ? stats.totalMs / stats.posts : 0,
    }),
  },
});
