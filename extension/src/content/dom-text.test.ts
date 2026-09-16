// @vitest-environment jsdom

/**
 * Reading a body out of the markup, and the two ways LinkedIn can collapse one.
 *
 * The question these settle: when a long post is hidden behind "…see more", is
 * the rest of the text still in the DOM? If it is, it can be read directly and
 * no click is needed. Both mechanisms are covered here because which one
 * LinkedIn uses is not something this repo gets to decide.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { extractPost } from "./extractor";
import {
  hiddenCharCount,
  readBlockText,
  readBothSources,
  recoversHiddenTail,
} from "./dom-text";

beforeEach(() => {
  document.body.innerHTML = "";
});

/** jsdom has no `innerText`; give one element a browser-like value. */
function stubInnerText(el: Element, value: string): void {
  Object.defineProperty(el, "innerText", { value, configurable: true });
}

describe("readBlockText", () => {
  it("rebuilds line breaks from block structure", () => {
    document.body.innerHTML = `<div id="b"><p>First line.</p><p>Second line.</p></div>`;
    const text = readBlockText(document.getElementById("b")!);
    expect(text.replace(/\n+/g, "\n").trim()).toBe("First line.\nSecond line.");
  });

  it("treats <br> as a line break", () => {
    document.body.innerHTML = `<div id="b">One<br>Two<br>Three</div>`;
    expect(readBlockText(document.getElementById("b")!).trim()).toBe("One\nTwo\nThree");
  });

  it("keeps inline runs on one line", () => {
    document.body.innerHTML = `<div id="b"><span>Cut p99 </span><span>to 310ms.</span></div>`;
    expect(readBlockText(document.getElementById("b")!).trim()).toBe("Cut p99 to 310ms.");
  });

  it("drops screen-reader duplicates of visible text", () => {
    // LinkedIn renders the actor name twice. `innerText` skips the off-screen
    // copy because it is not painted; walking the markup has to be told.
    document.body.innerHTML = `
      <div id="b"><span aria-hidden="true">Ana Ruiz</span><span class="visually-hidden">Ana Ruiz</span></div>`;
    expect(readBlockText(document.getElementById("b")!).trim()).toBe("Ana Ruiz");
  });

  it("drops button labels", () => {
    document.body.innerHTML = `<div id="b">Body text here.<button>…see more</button></div>`;
    expect(readBlockText(document.getElementById("b")!).trim()).toBe("Body text here.");
  });
});

describe("hiddenCharCount", () => {
  it("is ~0 when the markup and the rendering agree", () => {
    document.body.innerHTML = `<div id="b">Short post.</div>`;
    const el = document.getElementById("b")!;
    stubInnerText(el, "Short post.");
    expect(Math.abs(hiddenCharCount(readBothSources(el)))).toBeLessThan(5);
  });

  it("counts text the page has clipped but still holds", () => {
    document.body.innerHTML = `<div id="b">The visible opening line. And a great deal more text that the page has clamped out of view but never removed.</div>`;
    const el = document.getElementById("b")!;
    stubInnerText(el, "The visible opening line.");
    expect(hiddenCharCount(readBothSources(el))).toBeGreaterThan(40);
  });
});

describe("recoversHiddenTail", () => {
  it("accepts a genuine clipped continuation", () => {
    document.body.innerHTML = `<div id="b">The visible opening line. And a great deal more text that the page clamped out of view but never removed.</div>`;
    const el = document.getElementById("b")!;
    stubInnerText(el, "The visible opening line.…see more");
    expect(recoversHiddenTail(readBothSources(el), 40)).toBe(true);
  });

  it("rejects extra text that is not a continuation", () => {
    // Longer, but the rendered text is not a prefix — this is chrome the walk
    // picked up, not a clipped tail, and using it would inject junk.
    document.body.innerHTML = `
      <div id="b"><span class="tracking">sponsored-unit-4417 impression beacon payload</span><span>The visible opening line.</span></div>`;
    const el = document.getElementById("b")!;
    stubInnerText(el, "The visible opening line.");
    expect(recoversHiddenTail(readBothSources(el), 40)).toBe(false);
  });

  it("rejects a gain too small to be real content", () => {
    document.body.innerHTML = `<div id="b">The visible opening line. Plus a bit.</div>`;
    const el = document.getElementById("b")!;
    stubInnerText(el, "The visible opening line.");
    expect(recoversHiddenTail(readBothSources(el), 40)).toBe(false);
  });
});

const CLIPPED = "I got rejected 47 times. Then everything changed.";
const FULL =
  "I got rejected 47 times. Then everything changed. It took four years, " +
  "three rewrites and a 40% pay cut before the numbers moved at all.";

describe("a post collapsed with CSS", () => {
  it("is read in full from the markup, with no click", () => {
    document.body.innerHTML = `
      <div data-urn="urn:li:activity:1">
        <span class="update-components-actor__title"><span aria-hidden="true">Ana</span></span>
        <div class="update-components-text">${FULL}</div>
        <button class="inline-show-more-text__button" aria-label="see more">…see more</button>
      </div>`;

    const el = document.querySelector<HTMLElement>("[data-urn]")!;
    // The full text is in the DOM; only the painting is clamped.
    stubInnerText(el.querySelector(".update-components-text")!, `${CLIPPED}…see more`);

    const click = vi.fn();
    el.querySelector("button")!.addEventListener("click", click);

    const post = extractPost(el)!;

    expect(post.text).toContain("40% pay cut");
    expect(post.truncated).toBe(false);
    // The whole point: the user's feed is not touched.
    expect(click).not.toHaveBeenCalled();
  });
});

describe("a post truncated in the DOM", () => {
  it("falls back to the click, and is marked truncated", () => {
    document.body.innerHTML = `
      <div data-urn="urn:li:activity:2">
        <span class="update-components-actor__title"><span aria-hidden="true">Ana</span></span>
        <div class="update-components-text">${CLIPPED}…see more</div>
        <button class="inline-show-more-text__button" aria-label="see more"></button>
      </div>`;

    const el = document.querySelector<HTMLElement>("[data-urn]")!;
    stubInnerText(el.querySelector(".update-components-text")!, `${CLIPPED}…see more`);

    const click = vi.fn();
    el.querySelector("button")!.addEventListener("click", click);

    const post = extractPost(el)!;

    expect(post.text).toBe(CLIPPED);
    expect(post.truncated).toBe(true);
    expect(click).toHaveBeenCalledOnce();
  });

  it("does not click when expansion is disabled", () => {
    document.body.innerHTML = `
      <div data-urn="urn:li:activity:3">
        <div class="update-components-text">${CLIPPED}…see more</div>
        <button class="inline-show-more-text__button" aria-label="see more"></button>
      </div>`;

    const el = document.querySelector<HTMLElement>("[data-urn]")!;
    stubInnerText(el.querySelector(".update-components-text")!, `${CLIPPED}…see more`);

    const click = vi.fn();
    el.querySelector("button")!.addEventListener("click", click);

    extractPost(el, { expand: false });

    expect(click).not.toHaveBeenCalled();
  });
});
