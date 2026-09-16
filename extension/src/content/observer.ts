/**
 * Watches the feed for posts and emits each one exactly once, when visible.
 *
 * Three mechanisms, three jobs:
 *   MutationObserver     — discovers post elements as LinkedIn injects them.
 *   IntersectionObserver — tracks which of them are near the viewport.
 *   A steady tick        — re-reads the visible ones, because "visible" is not
 *                          the same as "ready", and on a virtualised feed it is
 *                          not the same as "still the same post" either.
 *
 * Discovery is cheap, so it runs eagerly. Extraction is not, so it is lazy and
 * guarded by a cheap identity probe.
 */

import type { ExtractedPost } from "@shared/types";
import { extractPost } from "./extractor";
import { findFeedRoot, findPosts, readUrn } from "./selectors";

/**
 * Render an unknown thrown value as something readable.
 *
 * `console.warn("...", error)` on a DOMException prints "[object
 * DOMException]", which names neither the failure nor the selector behind it.
 * The one real instance of this cost a round trip to diagnose.
 */
function describeError(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return String(error);
}

/** Whether a thrown value is an invalid-selector error. */
function isSelectorError(error: unknown): boolean {
  return error instanceof Error && error.name === "SyntaxError";
}

/** A broken selector fails identically on every post; say so once, loudly. */
let selectorErrorReported = false;

export interface ObserverOptions {
  /** Called once per post, after it becomes visible and is extracted. */
  onPost: (post: ExtractedPost, element: HTMLElement) => void;
  /** Start extracting this far before the post scrolls into view. */
  rootMargin?: string;
  /** How long to coalesce mutation bursts, in ms. */
  debounceMs?: number;
}

/** How often the visible set is re-read, in ms. */
const TICK_MS = 500;

/** A full re-scan runs every this many ticks, keeping discovery at ~1s. */
const SCAN_EVERY = 2;

/**
 * Consecutive failed extractions before an element is left alone.
 *
 * Ads and sidebar modules that slip past `looksLikePost` would otherwise be
 * re-read on every tick forever. The counter resets when the element's URN
 * changes, so a recycled node gets a fresh budget.
 */
const MAX_ATTEMPTS = 6;

export class FeedObserver {
  private readonly onPost: ObserverOptions["onPost"];
  private readonly debounceMs: number;
  private mutationObserver: MutationObserver | null = null;
  private readonly intersectionObserver: IntersectionObserver;

  /** Post ids already emitted, so re-renders of the same post stay silent. */
  private readonly emitted = new Set<string>();

  /**
   * Element → the post id last emitted from it.
   *
   * Keyed by element rather than marked on it. A DOM attribute cannot express
   * this: LinkedIn's feed is virtualised, so it recycles the same node for a
   * different post, and any "already handled" marker written onto the node
   * makes that node permanently invisible to us from then on. That is what the
   * hydration poll was really fighting — it ran forever and still could not
   * help, because the scan it drives skipped every marked element.
   */
  private readonly processed = new WeakMap<HTMLElement, string>();

  /** Elements registered with the viewport observer, to avoid re-registering. */
  private readonly registered = new WeakSet<HTMLElement>();

  /** Elements currently near the viewport, re-read on each tick. */
  private readonly visible = new Set<HTMLElement>();

  /** Consecutive failed extraction attempts, per element. */
  private readonly attempts = new WeakMap<HTMLElement, number>();

  /** The URN an element carried when it last failed, to detect recycling. */
  private readonly failedUrn = new WeakMap<HTMLElement, string>();

  private pendingScan: number | null = null;
  /** Subtrees awaiting a scan, coalesced across a mutation burst. */
  private dirty = new Set<Element>();
  /** The root currently under observation, to detect it being swapped out. */
  private observedRoot: Element | null = null;
  private tickTimer: number | null = null;
  private ticks = 0;

  /** Elements registered with the viewport observer, i.e. successful discovery. */
  private seenCount = 0;
  /** Elements that reached extraction but yielded no usable post. */
  private skipped = 0;
  /** Elements whose post id had already been emitted. */
  private duplicates = 0;
  /** Elements awaiting a usable body, still being retried. */
  private retrying = 0;

  /** Discovery counters, for `__unslop.report()`. */
  counters(): {
    seen: number;
    emitted: number;
    skipped: number;
    duplicates: number;
    retrying: number;
    visible: number;
  } {
    return {
      seen: this.seenCount,
      emitted: this.emitted.size,
      skipped: this.skipped,
      duplicates: this.duplicates,
      retrying: this.retrying,
      visible: this.visible.size,
    };
  }

  constructor(options: ObserverOptions) {
    this.onPost = options.onPost;
    this.debounceMs = options.debounceMs ?? 100;

    this.intersectionObserver = new IntersectionObserver(
      (entries) => this.handleIntersections(entries),
      { rootMargin: options.rootMargin ?? "200px 0px", threshold: 0 },
    );
  }

  /** Begin observing. Scans whatever is already on the page first. */
  start(): void {
    const root = findFeedRoot();
    this.scan(root);

    this.mutationObserver = new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (node instanceof Element) this.dirty.add(node);
        }
      }
      if (this.dirty.size > 0) this.scheduleScan();
    });

    this.mutationObserver.observe(root, { childList: true, subtree: true });
    this.observedRoot = root;

    this.startTicking();
  }

  /**
   * The steady tick: retry what is visible, and periodically re-scan.
   *
   * Retrying is the part that matters. A post can enter the viewport before
   * LinkedIn has filled in its body — which is the common case, since
   * `rootMargin` deliberately starts extraction before the post is on screen.
   * The old code unobserved the element before extracting, so a body that was
   * not ready yet meant that post was never scored, for the life of the page.
   * `IntersectionObserver` cannot fix this by itself: it fires on *changes* to
   * intersection, and an element that hydrates while already on screen never
   * produces another entry.
   */
  private startTicking(): void {
    this.tickTimer = setInterval(() => {
      this.ticks += 1;

      // Re-read everything near the viewport. The URN fast path in `process`
      // makes the steady-state cost one attribute read per visible element.
      for (const element of [...this.visible]) {
        if (!element.isConnected) {
          this.visible.delete(element);
          continue;
        }
        this.process(element);
      }

      if (this.ticks % SCAN_EVERY !== 0) return;

      const root = findFeedRoot();
      // If the root changed identity, the original observer is watching a
      // detached tree and will never fire again; re-point it at the live one.
      if (this.mutationObserver && root !== this.observedRoot) {
        this.observedRoot = root;
        this.mutationObserver.observe(root, { childList: true, subtree: true });
      }
      this.scan(root);
    }, TICK_MS) as unknown as number;
  }

  /** Stop observing and release everything. */
  stop(): void {
    this.mutationObserver?.disconnect();
    this.mutationObserver = null;
    this.observedRoot = null;
    this.intersectionObserver.disconnect();
    this.visible.clear();

    if (this.tickTimer !== null) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
    if (this.pendingScan !== null) {
      clearTimeout(this.pendingScan);
      this.pendingScan = null;
    }
  }

  /**
   * Coalesce a burst of mutations into one scan.
   *
   * LinkedIn's infinite scroll fires many childList mutations per batch of
   * posts; scanning on each one would be quadratic in a long feed.
   */
  private scheduleScan(): void {
    if (this.pendingScan !== null) return;
    this.pendingScan = setTimeout(() => {
      this.pendingScan = null;
      const roots = this.dirty;
      this.dirty = new Set();
      for (const root of roots) {
        if (root.isConnected) this.scan(root);
      }
    }, this.debounceMs) as unknown as number;
  }

  /** Register every not-yet-registered post in a subtree with the viewport observer. */
  private scan(root: Element): void {
    for (const post of findPosts(root)) {
      if (this.registered.has(post)) continue;
      this.registered.add(post);
      this.seenCount += 1;
      this.intersectionObserver.observe(post);
    }
  }

  private handleIntersections(entries: IntersectionObserverEntry[]): void {
    for (const entry of entries) {
      const element = entry.target as HTMLElement;
      if (entry.isIntersecting) {
        this.visible.add(element);
        // Try immediately; the tick is the retry, not the first attempt.
        this.process(element);
      } else {
        this.visible.delete(element);
      }
    }
  }

  /**
   * Read one element, emitting it if it holds a post we have not seen from it.
   *
   * The element is never unobserved. Whether this succeeds or fails, the
   * element stays in the visible set, because on a virtualised feed the same
   * node is reused for a different post as you scroll — and the only way to
   * notice is to look again.
   */
  private process(element: HTMLElement): void {
    const urn = readUrn(element);

    // Fast path: the element still holds the post we already emitted from it.
    // This is the steady-state cost of keeping elements under observation, and
    // it is a single attribute read — no body text, no layout.
    if (urn !== null && this.processed.get(element) === urn) return;

    const failures = this.attempts.get(element) ?? 0;
    if (failures >= MAX_ATTEMPTS) {
      // Give up, unless the node has been recycled for different content.
      if (urn !== null && this.failedUrn.get(element) === urn) return;
      if (urn === null) return;
      this.attempts.delete(element);
      this.failedUrn.delete(element);
      this.retrying = Math.max(0, this.retrying - 1);
    }

    let post: ExtractedPost | null;
    try {
      post = extractPost(element);
    } catch (error) {
      // A selector breaking must never take down the feed.
      if (isSelectorError(error) && !selectorErrorReported) {
        selectorErrorReported = true;
        // Not a per-post problem: an invalid selector throws for every post, so
        // the feed goes completely silent. Distinguishing it from "this one
        // post was odd" is the difference between a five-minute fix and an
        // afternoon.
        console.error(
          `[unslop] a CSS selector is invalid — every post will fail to ` +
            `extract until it is fixed. ${describeError(error)}`,
        );
      } else {
        console.warn(`[unslop] extraction failed — ${describeError(error)}`);
      }
      return;
    }

    if (!post) {
      // Not "skip this element forever" — the body may simply not have arrived
      // yet. Count the attempt and let the tick come back to it.
      const next = failures + 1;
      this.attempts.set(element, next);
      if (urn !== null) this.failedUrn.set(element, urn);
      if (next === 1) this.retrying += 1;
      if (next >= MAX_ATTEMPTS) {
        this.retrying = Math.max(0, this.retrying - 1);
        this.skipped += 1;
      }
      return;
    }

    if (failures > 0) {
      this.attempts.delete(element);
      this.failedUrn.delete(element);
      this.retrying = Math.max(0, this.retrying - 1);
    }

    // The element already gave us this post; nothing has changed.
    const previous = this.processed.get(element);
    if (previous === post.id) return;

    // Re-reading an element is what makes recycling and late hydration
    // recoverable, but it needs a stable identity to be safe. Without a URN the
    // id is a hash of the text, so "this node now holds a different post" and
    // "this post's text changed" are indistinguishable — and a "…see more"
    // expansion is exactly the second one. Emitting again would list a single
    // post twice, so an element that has already produced an unstable id is
    // left alone.
    if (previous !== undefined && !post.idIsStable) return;

    this.processed.set(element, post.id);

    if (this.emitted.has(post.id)) {
      this.duplicates += 1;
      return;
    }
    this.emitted.add(post.id);

    try {
      this.onPost(post, element);
    } catch (error) {
      console.warn(`[unslop] onPost handler failed — ${describeError(error)}`);
    }
  }
}
