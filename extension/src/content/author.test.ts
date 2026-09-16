// @vitest-environment jsdom

/**
 * Reading the poster's name out of whatever LinkedIn happens to ship.
 *
 * The old lookup was four class selectors and no fallback, so a class rotation
 * turned every row into "Unknown author" at once. Each case below is a markup
 * shape that must still resolve — and the cleaning cases matter as much as the
 * finding ones, because none of these sources arrive as a bare name.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { cleanAuthorName, findAuthor, nameFromProfileUrl } from "./author";
import { findBody } from "./selectors";

beforeEach(() => {
  document.body.innerHTML = "";
});

function post(inner: string): HTMLElement {
  document.body.innerHTML = `<div data-urn="urn:li:activity:1">${inner}</div>`;
  return document.querySelector<HTMLElement>("[data-urn]")!;
}

describe("finding the name", () => {
  it("reads the classic actor title", () => {
    expect(
      findAuthor(
        post(`<span class="update-components-actor__title">
                <span aria-hidden="true">Ana Ruiz</span>
                <span class="visually-hidden">Ana Ruiz</span>
              </span>`),
      ),
    ).toBe("Ana Ruiz");
  });

  it("survives a rotated class name via the attribute selector", () => {
    expect(
      findAuthor(
        post(`<span class="ABC123-actor__title xyz"><span aria-hidden="true">Ana Ruiz</span></span>`),
      ),
    ).toBe("Ana Ruiz");
  });

  it("falls back to the actor link's text", () => {
    // No actor class at all — the shape that produced "Unknown author".
    expect(
      findAuthor(post(`<a href="/in/ana-ruiz/"><span>Ana Ruiz</span></a><p>Body text.</p>`)),
    ).toBe("Ana Ruiz");
  });

  it("falls back to the link's aria-label", () => {
    expect(
      findAuthor(post(`<a href="/in/ana-ruiz/" aria-label="View Ana Ruiz’s profile"><img src="x.png"></a>`)),
    ).toBe("Ana Ruiz");
  });

  it("falls back to the avatar's alt text", () => {
    expect(
      findAuthor(post(`<a href="/in/ana-ruiz/"><img alt="Ana Ruiz’s profile photo" src="x.png"></a>`)),
    ).toBe("Ana Ruiz");
  });

  it("falls back to the profile slug", () => {
    expect(
      findAuthor(post(`<a href="/in/ana-ruiz-8b4a21/"><img src="x.png"></a>`)),
    ).toBe("Ana Ruiz");
  });

  it("reads a company page", () => {
    expect(findAuthor(post(`<a href="/company/acme-corp/"><img src="x.png"></a>`))).toBe(
      "Acme Corp",
    );
  });

  it("prefers the actor block over a mention in the body", () => {
    expect(
      findAuthor(
        post(`<div class="update-components-actor"><a href="/in/ana-ruiz/">Ana Ruiz</a></div>
              <p>Great work from <a href="/in/ben-shah/">Ben Shah</a> on this.</p>`),
      ),
    ).toBe("Ana Ruiz");
  });

  it("looks above the element when the URN sits on an inner wrapper", () => {
    document.body.innerHTML = `
      <div class="card">
        <a href="/in/ana-ruiz/"><span>Ana Ruiz</span></a>
        <div data-urn="urn:li:activity:1"><p>Body text lives in the inner wrapper.</p></div>
      </div>`;
    const inner = document.querySelector<HTMLElement>("[data-urn]")!;
    expect(findAuthor(inner)).toBe("Ana Ruiz");
  });

  it("refuses an ancestor that covers more than one post", () => {
    document.body.innerHTML = `
      <div id="feed">
        <a href="/in/ana-ruiz/">Ana Ruiz</a>
        <a href="/in/ben-shah/">Ben Shah</a>
        <div data-urn="urn:li:activity:1"><p>Body text with no actor of its own.</p></div>
      </div>`;
    const inner = document.querySelector<HTMLElement>("[data-urn]")!;
    expect(findAuthor(inner)).toBeNull();
  });

  it("returns null when there is genuinely nothing", () => {
    expect(findAuthor(post(`<p>Just body text, no actor, no links.</p>`))).toBeNull();
  });
});

/**
 * Whole post cards, in the shape LinkedIn actually ships them: a social-context
 * line above the actor, comments below the body. These are the cases where the
 * panel was reporting somebody else's name.
 */
describe("picking the author out of a full card", () => {
  function card(inner: string): HTMLElement {
    document.body.innerHTML = `<div data-urn="urn:li:activity:1">${inner}</div>`;
    return document.querySelector<HTMLElement>("[data-urn]")!;
  }

  const BODY = `<div class="update-components-text">We cut p99 latency from 2.4s to 310ms by batching the lookup query and adding a partial index.</div>`;

  const COMMENTS = `
    <div class="comments-comments-list">
      <article class="comments-comment-item">
        <a href="/in/dana-lee/"><span>Dana Lee</span></a><span>Great write-up!</span>
      </article>
      <article class="comments-comment-item">
        <a href="/in/erik-moss/"><span>Erik Moss</span></a><span>Saving this.</span>
      </article>
    </div>`;

  it("ignores the social-context line above the actor", () => {
    // "Ben Shah commented on this" is the first profile link in the card, and
    // it is not the author.
    const post = card(`
      <div class="update-components-header">
        <a href="/in/ben-shah/">Ben Shah</a> commented on this
      </div>
      <div class="update-components-actor">
        <a href="/in/ana-ruiz/"><span aria-hidden="true">Ana Ruiz</span></a>
      </div>
      ${BODY}`);
    expect(findAuthor(post, findBody(post))).toBe("Ana Ruiz");
  });

  it("ignores commenters below the body", () => {
    const post = card(`
      <div class="update-components-actor">
        <a href="/in/ana-ruiz/"><span aria-hidden="true">Ana Ruiz</span></a>
      </div>
      ${BODY}
      ${COMMENTS}`);
    expect(findAuthor(post, findBody(post))).toBe("Ana Ruiz");
  });

  it("ignores both at once, with no actor class to help", () => {
    // The hard case: every class has rotated, so position is all there is.
    const post = card(`
      <div class="ctx"><a href="/in/ben-shah/">Ben Shah</a> reposted this</div>
      <div class="hdr"><a href="/in/ana-ruiz/"><span>Ana Ruiz</span></a></div>
      ${BODY}
      <div class="cmts">
        <div><a href="/in/dana-lee/">Dana Lee</a> Nice one</div>
      </div>`);
    expect(findAuthor(post, findBody(post))).toBe("Ana Ruiz");
  });

  it("ignores a mention inside the body", () => {
    const post = card(`
      <div class="update-components-actor">
        <a href="/in/ana-ruiz/"><span aria-hidden="true">Ana Ruiz</span></a>
      </div>
      <div class="update-components-text">
        Huge credit to <a href="/in/ben-shah/">Ben Shah</a> for the batching idea
        that cut p99 latency from 2.4s to 310ms on the lookup path.
      </div>`);
    expect(findAuthor(post, findBody(post))).toBe("Ana Ruiz");
  });

  it("does not report a commenter when the author block is missing entirely", () => {
    // Nothing before the body. "Unknown author" is honest; "Dana Lee" is a lie.
    const post = card(`${BODY}${COMMENTS}`);
    expect(findAuthor(post, findBody(post))).toBeNull();
  });

  it("does not take a name from the reaction summary", () => {
    const post = card(`
      <div class="update-components-actor">
        <a href="/in/ana-ruiz/"><span aria-hidden="true">Ana Ruiz</span></a>
      </div>
      ${BODY}
      <div class="social-details-social-counts">
        <a href="/in/dana-lee/">Dana Lee</a> and 12 others
      </div>`);
    expect(findAuthor(post, findBody(post))).toBe("Ana Ruiz");
  });
});

describe("cleaning the name", () => {
  it("collapses a name the markup rendered twice", () => {
    // The doubling that produced "Ana RuizAna Ruiz" in the panel.
    expect(cleanAuthorName("Ana RuizAna Ruiz")).toBe("Ana Ruiz");
    expect(cleanAuthorName("Ana Ruiz Ana Ruiz")).toBe("Ana Ruiz");
  });

  it("drops the headline that follows the name", () => {
    expect(cleanAuthorName("Ana Ruiz · Staff Engineer at Somewhere")).toBe("Ana Ruiz");
    expect(cleanAuthorName("Ana Ruiz • 3rd+ • 2h")).toBe("Ana Ruiz");
  });

  it("drops a trailing connection degree with no separator", () => {
    expect(cleanAuthorName("Ana Ruiz 3rd+")).toBe("Ana Ruiz");
    expect(cleanAuthorName("Ana Ruiz• 3rd+Ana Ruiz")).toBe("Ana Ruiz");
  });

  it("unwraps aria-label and alt phrasing", () => {
    expect(cleanAuthorName("View Ana Ruiz's profile")).toBe("Ana Ruiz");
    expect(cleanAuthorName("Ana Ruiz’s profile photo")).toBe("Ana Ruiz");
  });

  it("takes the first line when a headline follows on the next", () => {
    expect(cleanAuthorName("Ana Ruiz\nStaff Engineer at Somewhere")).toBe("Ana Ruiz");
  });

  it("rejects chrome that is not a name", () => {
    for (const junk of ["Follow", "+ Follow", "Promoted", "See more", "•", "  "]) {
      expect(cleanAuthorName(junk), junk).toBeNull();
    }
  });

  it("rejects a string too long to be a name", () => {
    expect(cleanAuthorName("A".repeat(120))).toBeNull();
  });
});

describe("nameFromProfileUrl", () => {
  it("drops LinkedIn's trailing id segment", () => {
    expect(nameFromProfileUrl("/in/ana-ruiz-8b4a21/")).toBe("Ana Ruiz");
  });

  it("keeps a name that has no id segment", () => {
    expect(nameFromProfileUrl("/in/ana-ruiz/")).toBe("Ana Ruiz");
  });

  it("handles an absolute url with query params", () => {
    expect(
      nameFromProfileUrl("https://www.linkedin.com/in/ana-ruiz-8b4a21/?trk=feed"),
    ).toBe("Ana Ruiz");
  });

  it("returns null for a non-profile url", () => {
    expect(nameFromProfileUrl("/feed/update/urn:li:activity:1/")).toBeNull();
  });
});
