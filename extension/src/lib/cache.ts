/**
 * Per-session verdict cache.
 *
 * LinkedIn recycles post elements as you scroll, so the same post is extracted
 * repeatedly in one session. Caching by post id keeps re-scrolling free.
 *
 * `sessionStorage` rather than `localStorage`: verdicts are cheap to recompute
 * and the weights change between builds, so a cache that outlived the tab would
 * mostly serve stale results from an older scorer.
 */

import { SCORER_VERSION } from "./labels";

/**
 * Namespaced by scorer version. `sessionStorage` already bounds staleness to
 * the tab, but a tab left open across an extension reload would otherwise be
 * served verdicts computed by weights that no longer exist.
 */
const PREFIX = `unslop:${SCORER_VERSION}:`;

/** What is persisted. Features are not cached — they are large and rebuildable. */
export interface CachedVerdict {
  verdict: string;
  score: number;
  confidence: number;
  signals: { key: string; label: string; weight: number }[];
  /** Whether the score sat close enough to a threshold to be borderline. */
  uncertain: boolean;
}

/**
 * In-memory mirror, so a hot feed does not hit `sessionStorage` on every post.
 * Storage access is synchronous and shows up in scroll profiles.
 */
const memory = new Map<string, CachedVerdict>();

/** Read a cached verdict. Returns null on a miss or malformed entry. */
export function readCache(postId: string): CachedVerdict | null {
  const hit = memory.get(postId);
  if (hit) return hit;

  try {
    const raw = sessionStorage.getItem(PREFIX + postId);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedVerdict;
    memory.set(postId, parsed);
    return parsed;
  } catch {
    // Private browsing, disabled storage, or a bad entry — all mean "miss".
    return null;
  }
}

/** Store a verdict. Failures are silent; the cache is an optimization only. */
export function writeCache(postId: string, verdict: CachedVerdict): void {
  memory.set(postId, verdict);
  try {
    sessionStorage.setItem(PREFIX + postId, JSON.stringify(verdict));
  } catch {
    // Quota exceeded or storage unavailable. The in-memory mirror still works
    // for the life of the page, which covers the common re-scroll case.
  }
}

/** Drop every cached verdict, in memory and in storage. */
export function clearCache(): void {
  memory.clear();
  try {
    const stale: string[] = [];
    for (let i = 0; i < sessionStorage.length; i++) {
      const key = sessionStorage.key(i);
      if (key?.startsWith(PREFIX)) stale.push(key);
    }
    for (const key of stale) sessionStorage.removeItem(key);
  } catch {
    // Nothing to do — the in-memory clear above is the part that matters.
  }
}

/** Number of verdicts held in memory, for the debug console. */
export function cacheSize(): number {
  return memory.size;
}
