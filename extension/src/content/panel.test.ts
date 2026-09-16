// @vitest-environment jsdom

/**
 * The panel's contract with the page it floats over.
 *
 * Most of this file is about scrolling. An overlay that quietly breaks the
 * host page's scroll is the classic way an extension makes a site feel broken,
 * and every mechanism that does it — a non-passive wheel listener, a locked
 * `body`, scroll chaining out of an inner list — is invisible in a screenshot.
 * So they are asserted rather than eyeballed.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ExtractedPost } from "@shared/types";
import type { ScoredPost } from "../lib/scoring/scorer";

const HOST = "[data-unslop-panel]";

/** Listener types that, bound to the document, would hijack page scrolling. */
const SCROLL_EVENTS = ["wheel", "mousewheel", "touchmove", "scroll", "DOMMouseScroll"];

function post(id: string, overrides: Partial<ExtractedPost> = {}): ExtractedPost {
  return {
    id,
    idIsStable: true,
    text: "We cut p99 latency from 2.4s to 310ms by batching the lookup query.",
    rawText: "",
    author: "Ana Ruiz",
    truncated: false,
    links: [],
    hasMedia: false,
    isReshare: false,
    extractionMs: 0,
    ...overrides,
  };
}

function scored(verdict: "green" | "yellow" | "red" = "green"): ScoredPost {
  return {
    postId: "x",
    verdict,
    score: 0.12,
    confidence: 0.8,
    signals: [{ key: "numberDensity", label: "Contains concrete numbers", weight: -0.6 }],
    source: "rules",
    uncertain: false,
  };
}

/** Fresh module instance and a clean document for each test. */
async function loadPanel() {
  vi.resetModules();
  document.documentElement.querySelectorAll(HOST).forEach((n) => n.remove());
  document.body.innerHTML = "";
  document.getElementById("unslop-flash-styles")?.remove();
  return import("./panel");
}

beforeEach(() => {
  // jsdom implements neither, and the panel calls both when a row is clicked.
  Element.prototype.scrollIntoView = vi.fn();
  try {
    sessionStorage.clear();
  } catch {
    /* not available in this environment */
  }
});

describe("page scrolling is left alone", () => {
  it("registers no scroll-hijacking listeners on document or window", async () => {
    const docSpy = vi.spyOn(document, "addEventListener");
    const winSpy = vi.spyOn(window, "addEventListener");
    const bodySpy = vi.spyOn(document.body, "addEventListener");

    const { showPost } = await loadPanel();
    showPost(document.body, post("a"), scored());

    for (const spy of [docSpy, winSpy, bodySpy]) {
      const bound = spy.mock.calls.map(([type]) => String(type));
      expect(bound.filter((t) => SCROLL_EVENTS.includes(t))).toEqual([]);
    }
  });

  it("never locks the document's own scrolling", async () => {
    const { showPost, getPanel } = await loadPanel();
    showPost(document.body, post("a"), scored());
    getPanel();

    for (const node of [document.body, document.documentElement]) {
      expect(node.style.overflow).toBe("");
      expect(node.style.position).toBe("");
    }
  });

  it("floats in fixed position so it occupies no layout space", async () => {
    const { getPanel } = await loadPanel();
    getPanel();

    const css = document.querySelector(HOST)!.shadowRoot!.querySelector("style")!.textContent!;
    expect(css).toMatch(/position:\s*fixed\s*!important/);
  });

  it("contains its own overscroll so the list does not chain into the feed", async () => {
    const { getPanel } = await loadPanel();
    getPanel();

    const css = document.querySelector(HOST)!.shadowRoot!.querySelector("style")!.textContent!;
    const list = css.slice(css.indexOf(".list {"), css.indexOf(".list::"));
    expect(list).toMatch(/overscroll-behavior:\s*contain/);
    expect(list).toMatch(/overflow-y:\s*auto/);
  });
});

describe("dismissal", () => {
  it("stays up until the close button is clicked", async () => {
    const { getPanel } = await loadPanel();
    getPanel();

    const root = document.querySelector(HOST)!.shadowRoot!;
    const panel = root.querySelector<HTMLElement>(".panel")!;
    const reopen = root.querySelector<HTMLButtonElement>(".reopen")!;

    expect(panel.style.display).toBe("");
    expect(reopen.hidden).toBe(true);

    root.querySelector<HTMLButtonElement>(".close")!.click();

    expect(panel.style.display).toBe("none");
    expect(reopen.hidden).toBe(false);
  });

  it("brings the panel back from the pill", async () => {
    const { getPanel } = await loadPanel();
    getPanel();

    const root = document.querySelector(HOST)!.shadowRoot!;
    root.querySelector<HTMLButtonElement>(".close")!.click();
    root.querySelector<HTMLButtonElement>(".reopen")!.click();

    expect(root.querySelector<HTMLElement>(".panel")!.style.display).toBe("");
    expect(root.querySelector<HTMLButtonElement>(".reopen")!.hidden).toBe(true);
  });

  it("remembers the dismissal for the rest of the tab", async () => {
    const first = await loadPanel();
    first.getPanel();
    document
      .querySelector(HOST)!
      .shadowRoot!.querySelector<HTMLButtonElement>(".close")!
      .click();

    // A SPA navigation re-injects the panel; it must not pop back up.
    const second = await loadPanel();
    second.getPanel();

    const root = document.querySelector(HOST)!.shadowRoot!;
    expect(root.querySelector<HTMLElement>(".panel")!.style.display).toBe("none");
    expect(root.querySelector<HTMLButtonElement>(".reopen")!.hidden).toBe(false);
  });
});

describe("listing", () => {
  it("lists a post and counts it", async () => {
    const { showPost, listedCount } = await loadPanel();
    showPost(document.body, post("a"), scored("red"));

    const root = document.querySelector(HOST)!.shadowRoot!;
    expect(listedCount()).toBe(1);
    expect(root.querySelector(".author")!.textContent).toContain("Ana Ruiz");
    expect(root.querySelector(".dot")!.className).toContain("red");
  });

  it("ignores a post it has already listed", async () => {
    const { showPost, listedCount } = await loadPanel();
    showPost(document.body, post("a"), scored());
    showPost(document.body, post("a"), scored());

    expect(listedCount()).toBe(1);
  });

  it("shows newest first", async () => {
    const { showPost } = await loadPanel();
    showPost(document.body, post("a", { author: "First" }), scored());
    showPost(document.body, post("b", { author: "Second" }), scored());

    const root = document.querySelector(HOST)!.shadowRoot!;
    const authors = [...root.querySelectorAll(".author")].map((n) => n.textContent);
    expect(authors).toEqual(["Second", "First"]);
  });

  it("marks a truncated post as provisional", async () => {
    // plan.md problem #4: the flag existed but nothing consumed it, so a post
    // scored on its hook line alone looked identical to one scored in full.
    const { showPost } = await loadPanel();
    showPost(document.body, post("a", { truncated: true }), scored());

    const root = document.querySelector(HOST)!.shadowRoot!;
    expect(root.querySelector(".flag")!.textContent).toBe("partial");
    expect(root.querySelector(".meta")!.textContent).toContain("provisional");
  });

  it("locates the post when a row is opened", async () => {
    const { showPost } = await loadPanel();
    const element = document.createElement("div");
    document.body.append(element);
    showPost(element, post("a"), scored());

    document.querySelector(HOST)!.shadowRoot!.querySelector<HTMLButtonElement>(".head")!.click();

    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
    expect(element.hasAttribute("data-unslop-flash")).toBe(true);
  });

  it("clears the list on navigation", async () => {
    const { showPost, resetPanel, listedCount } = await loadPanel();
    showPost(document.body, post("a"), scored());
    resetPanel();

    expect(listedCount()).toBe(0);
    expect(document.querySelector(HOST)!.shadowRoot!.querySelector(".empty")).not.toBeNull();
  });
});
