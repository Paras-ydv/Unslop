/**
 * Watches the feed for posts and emits each one exactly once, when visible.
 *
 * Two observers, two jobs:
 *   MutationObserver    — discovers post elements as LinkedIn injects them.
 *   IntersectionObserver — defers extraction until a post enters the viewport.
 *
 * Discovery is cheap, so it runs eagerly. Extraction is not, so it is lazy.
 */

import type { ExtractedPost } from "@shared/types";
import { extractPost } from "./extractor";
import { findFeedRoot, findPosts } from "./selectors";

export interface ObserverOptions {
  /** Called once per post, after it becomes visible and is extracted. */
  onPost: (post: ExtractedPost, element: HTMLElement) => void;
  /** Start extracting this far before the post scrolls into view. */
  rootMargin?: string;
  /** How long to coalesce mutation bursts, in ms. */
  debounceMs?: number;
}

/** Marks elements already handed to the IntersectionObserver. */
const SEEN_ATTR = "data-unslop-seen";

export class FeedObserver {
  private readonly onPost: ObserverOptions["onPost"];
  private readonly debounceMs: number;
  private mutationObserver: MutationObserver | null = null;
  private readonly intersectionObserver: IntersectionObserver;
  /** Post ids already emitted, so re-renders of the same post stay silent. */
  private readonly emitted = new Set<string>();
  private pendingScan: number | null = null;
  /** Subtrees awaiting a scan, coalesced across a mutation burst. */
  private dirty = new Set<Element>();

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
  }

  /** Stop observing and release both observers. */
  stop(): void {
    this.mutationObserver?.disconnect();
    this.mutationObserver = null;
    this.intersectionObserver.disconnect();
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

  /** Register every not-yet-seen post in a subtree with the viewport observer. */
  private scan(root: Element): void {
    for (const post of findPosts(root)) {
      if (post.hasAttribute(SEEN_ATTR)) continue;
      post.setAttribute(SEEN_ATTR, "");
      this.intersectionObserver.observe(post);
    }
  }

  private handleIntersections(entries: IntersectionObserverEntry[]): void {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const element = entry.target as HTMLElement;

      // Extraction happens once per element regardless of outcome, so a post
      // that yields nothing usable is not retried on every scroll.
      this.intersectionObserver.unobserve(element);
      this.process(element);
    }
  }

  private process(element: HTMLElement): void {
    let post: ExtractedPost | null;
    try {
      post = extractPost(element);
    } catch (error) {
      // A selector breaking must never take down the feed.
      console.warn("[unslop] extraction failed", error);
      return;
    }

    if (!post) return;
    if (this.emitted.has(post.id)) return;
    this.emitted.add(post.id);

    try {
      this.onPost(post, element);
    } catch (error) {
      console.warn("[unslop] onPost handler failed", error);
    }
  }
}
