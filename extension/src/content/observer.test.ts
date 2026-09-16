// @vitest-environment jsdom

/**
 * The two ways the feed used to go quiet.
 *
 * Both were reported as "discovery froze after the first few posts", both were
 * blamed on the hydration poll, and neither was fixed by making that poll run
 * forever — because the poll's scan skipped any element already marked as
 * handled, and in both of these the element is already marked.
 */

import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import type { ExtractedPost } from "@shared/types";
import { FeedObserver } from "./observer";

/** Elements handed to the stub observer, so tests can drive intersection. */
let targets: Set<Element>;
let notify: (entries: { target: Element; isIntersecting: boolean }[]) => void;

class StubIntersectionObserver {
  constructor(callback: (entries: unknown[]) => void) {
    notify = (entries) => callback(entries as unknown[]);
  }
  observe(target: Element): void {
    targets.add(target);
  }
  unobserve(target: Element): void {
    targets.delete(target);
  }
  disconnect(): void {
    targets.clear();
  }
}

/** Mark everything currently registered as on-screen. */
function scrollIntoView(): void {
  notify([...targets].map((target) => ({ target, isIntersecting: true })));
}

/**
 * A post card, with or without its body.
 *
 * The header chrome is deliberately verbatim-sized: a card mid-hydration still
 * carries the actor block, which is what makes it discoverable while its body
 * is still empty. That gap is the whole scenario — an empty shell with no text
 * at all is simply not found yet, and the next scan picks it up normally.
 */
function card(urn: string, body: string | null): string {
  return `
    <div data-urn="${urn}">
      <a href="/in/ana/"><span class="update-components-actor__title">Ana Ruiz</span></a>
      <span>Staff Engineer at Somewhere · 3rd+ · 2h · Edited</span>
      ${body === null ? "" : `<div class="update-components-text">${body}</div>`}
    </div>`;
}

const BODY =
  "We cut p99 latency from 2.4s to 310ms by batching the lookup query and " +
  "adding a partial index on the events table.";

beforeEach(() => {
  targets = new Set();
  vi.stubGlobal("IntersectionObserver", StubIntersectionObserver);
  vi.useFakeTimers();
  document.body.innerHTML = "";
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("a post whose body arrives late", () => {
  it("is picked up once it hydrates, not skipped for the life of the page", () => {
    // The element is in the DOM and on screen, but LinkedIn has not filled in
    // the body yet. `rootMargin` means this is the *normal* case, not a race.
    document.body.innerHTML = `<div id="feed">${card("urn:li:activity:1", null)}</div>`;

    const seen: ExtractedPost[] = [];
    const observer = new FeedObserver({ onPost: (post) => seen.push(post) });
    observer.start();
    scrollIntoView();

    // Old behaviour: unobserved before extraction, so this post was gone.
    expect(seen).toHaveLength(0);
    expect(observer.counters().retrying).toBe(1);

    document.querySelector("[data-urn]")!.innerHTML +=
      `<div class="update-components-text">${BODY}</div>`;

    // No further intersection event fires — the element never left the
    // viewport — so recovery has to come from the tick.
    vi.advanceTimersByTime(600);

    expect(seen).toHaveLength(1);
    expect(seen[0]!.text).toContain("310ms");
    expect(observer.counters().retrying).toBe(0);

    observer.stop();
  });

  it("gives up on an element that never yields a body", () => {
    // An ad that slipped past `looksLikePost` must not be re-read forever.
    document.body.innerHTML = `<div id="feed">${card("urn:li:activity:9", null)}</div>`;

    const observer = new FeedObserver({ onPost: () => {} });
    observer.start();
    scrollIntoView();

    vi.advanceTimersByTime(10_000);

    expect(observer.counters().skipped).toBe(1);
    expect(observer.counters().retrying).toBe(0);

    observer.stop();
  });
});

describe("a recycled element", () => {
  it("is re-read when the feed reuses it for a different post", () => {
    // LinkedIn's feed is virtualised: this is the same node, reused. Any
    // "already handled" marker written onto it makes the new post invisible.
    document.body.innerHTML = `<div id="feed">${card("urn:li:activity:1", BODY)}</div>`;

    const seen: ExtractedPost[] = [];
    const observer = new FeedObserver({ onPost: (post) => seen.push(post) });
    observer.start();
    scrollIntoView();

    expect(seen).toHaveLength(1);

    const element = document.querySelector("[data-urn]")!;
    element.setAttribute("data-urn", "urn:li:activity:2");
    element.querySelector(".update-components-text")!.textContent =
      "Second post. We shipped the migration in 40 minutes with zero downtime.";

    vi.advanceTimersByTime(600);

    expect(seen).toHaveLength(2);
    expect(seen[1]!.id).toBe("urn:li:activity:2");

    observer.stop();
  });

  it("costs nothing while the element still holds the same post", () => {
    document.body.innerHTML = `<div id="feed">${card("urn:li:activity:1", BODY)}</div>`;

    const seen: ExtractedPost[] = [];
    const observer = new FeedObserver({ onPost: (post) => seen.push(post) });
    observer.start();
    scrollIntoView();

    vi.advanceTimersByTime(5_000);

    // Ten ticks, one emission: the URN fast path short-circuits before any
    // body text is read.
    expect(seen).toHaveLength(1);
    expect(observer.counters().duplicates).toBe(0);

    observer.stop();
  });
});

describe("a post that expands after it was listed", () => {
  it("is not listed twice when it has no URN to identify it", () => {
    // A "…see more" expansion rewrites the body, which changes the content
    // hash a URN-less post is identified by. Re-reading the element would
    // otherwise emit the same post a second time under a new id.
    document.body.innerHTML = `
      <div id="feed"><div>
        <a href="/in/ana/"><span class="update-components-actor__title">Ana Ruiz</span></a>
        <span>Staff Engineer at Somewhere · 3rd+ · 2h</span>
        <div class="update-components-text">${BODY}…see more</div>
      </div></div>`;

    const seen: ExtractedPost[] = [];
    const observer = new FeedObserver({ onPost: (post) => seen.push(post) });
    observer.start();
    scrollIntoView();
    expect(seen).toHaveLength(1);

    document.querySelector(".update-components-text")!.textContent =
      `${BODY} It took four years and three rewrites to get there.`;
    vi.advanceTimersByTime(1200);

    expect(seen).toHaveLength(1);

    observer.stop();
  });
});

describe("teardown", () => {
  it("stops ticking once stopped", () => {
    document.body.innerHTML = `<div id="feed">${card("urn:li:activity:1", BODY)}</div>`;

    const seen: ExtractedPost[] = [];
    const observer = new FeedObserver({ onPost: (post) => seen.push(post) });
    observer.start();
    scrollIntoView();
    observer.stop();

    document.body.innerHTML = `<div id="feed">${card("urn:li:activity:7", BODY)}</div>`;
    vi.advanceTimersByTime(5_000);

    expect(seen).toHaveLength(1);
  });
});
