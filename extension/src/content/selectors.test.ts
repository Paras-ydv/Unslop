// @vitest-environment jsdom

/**
 * Regression tests for post discovery.
 *
 * This layer had no coverage, which is why "one badge over three posts" shipped
 * twice: the symptom only appears against markup nobody had in a test. These
 * build the markup instead.
 *
 * `textLength` reads `textContent`, not `innerText`, so these run under jsdom —
 * which implements the former and not the latter. That is a happy consequence
 * of avoiding a layout flush, not the reason for it.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { findPosts, looksLikePost } from "./selectors";
import { extractPost } from "./extractor";

/** Body text long enough to clear the 80-character floor. */
function body(marker: string): string {
  return `${marker}: we cut p99 latency from 2.4s to 310ms by batching the ` +
    `lookup query and adding a partial index on the events table.`;
}

/** One post card, in markup that matches none of the class-name selectors. */
function postCard(name: string, marker: string): string {
  return `
    <div class="x">
      <div class="y"><a href="/in/${name}/"><span>${name}</span></a>
        <span>Staff Engineer at Somewhere</span></div>
      <div class="z"><span>${body(marker)}</span></div>
    </div>`;
}

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("structural discovery", () => {
  it("keeps sibling posts separate instead of merging them", () => {
    // The original bug. Three posts, ~180 characters each, so the whole feed is
    // comfortably under the 6000-character cap that was supposed to stop the
    // upward walk. Bounding on text length alone returns the wrapper.
    document.body.innerHTML = `
      <div id="feed">
        ${postCard("ana", "A")}
        ${postCard("ben", "B")}
        ${postCard("cara", "C")}
      </div>`;

    const posts = findPosts(document.body);

    expect(posts).toHaveLength(3);
    expect(posts.some((p) => p.id === "feed")).toBe(false);
    for (const post of posts) {
      // Each container describes exactly one author.
      expect(post.querySelectorAll('a[href*="/in/"]').length).toBe(1);
    }
  });

  it("returns a container that still holds the post body", () => {
    document.body.innerHTML = `<div id="feed">${postCard("ana", "A")}</div>`;

    const posts = findPosts(document.body);

    expect(posts).toHaveLength(1);
    // Discovery is worthless if it stops at the actor header.
    expect(posts[0]!.textContent).toContain("310ms");
  });

  // A feed holding exactly one post is structurally indistinguishable from the
  // post itself, and returning either yields the same text. The wrapper above
  // it is not ambiguous, and is what must never be returned.
  it("does not climb past a post into the page wrapper", () => {
    document.body.innerHTML = `
      <div id="page">
        <nav><a href="/in/me/">Me</a></nav>
        <div id="feed">${postCard("ana", "A")}</div>
      </div>`;

    for (const post of findPosts(document.body)) {
      expect(post.id).not.toBe("page");
    }
  });
});

describe("looksLikePost", () => {
  it("accepts a post card", () => {
    document.body.innerHTML = postCard("ana", "A");
    expect(looksLikePost(document.body.firstElementChild!)).toBe(true);
  });

  it("rejects a module with no author", () => {
    // "People you may know", ads and job cards all match the broad selector
    // list. Letting them through buries real failures in the skip counter.
    document.body.innerHTML = `
      <div id="promo"><h2>Jobs you may be interested in</h2>
        <p>${"Senior Engineer, Remote. ".repeat(6)}</p></div>`;
    expect(looksLikePost(document.getElementById("promo")!)).toBe(false);
  });

  it("rejects a container holding many authors", () => {
    document.body.innerHTML = `
      <div id="feed">
        ${postCard("ana", "A")}${postCard("ben", "B")}
        ${postCard("cara", "C")}${postCard("dev", "D")}
      </div>`;
    expect(looksLikePost(document.getElementById("feed")!)).toBe(false);
  });

  it("rejects a fragment too short to be a body", () => {
    document.body.innerHTML = `<div id="tiny"><a href="/in/ana/">Ana</a></div>`;
    expect(looksLikePost(document.getElementById("tiny")!)).toBe(false);
  });
});

/**
 * Comments are the hardest thing to tell from posts: same shape, same author
 * link, often their own URN. Discovery anchored on author links, so every
 * commenter looked like a small post — and they were listed as such.
 */
describe("comments are not posts", () => {
  const REAL_POST = `
    <div class="update-components-actor"><a href="/in/ana-ruiz/">Ana Ruiz</a></div>
    <div class="update-components-text">We cut p99 latency from 2.4s to 310ms by batching the lookup query and adding a partial index on events.</div>`;

  const COMMENTS = `
    <div class="comments-comments-list">
      <article class="comments-comment-item" data-id="urn:li:comment:(urn:li:activity:1,99)">
        <a href="/in/dana-lee/">Dana Lee</a>
        <span>${"A long and thoughtful comment about the numbers involved. ".repeat(2)}</span>
      </article>
      <article class="comments-comment-item">
        <a href="/in/erik-moss/">Erik Moss</a>
        <span>${"Saving this for later, the partial index trick is new to me. ".repeat(2)}</span>
      </article>
    </div>`;

  it("does not list comments as posts", () => {
    document.body.innerHTML = `
      <div id="feed"><div data-urn="urn:li:activity:1">${REAL_POST}${COMMENTS}</div></div>`;

    const posts = findPosts(document.body);

    expect(posts).toHaveLength(1);
    expect(posts[0]!.getAttribute("data-urn")).toBe("urn:li:activity:1");
  });

  it("does not fold comment text into the scored post", () => {
    // The container legitimately wraps its own comments, so discovery cannot
    // separate them — the body reader has to.
    document.body.innerHTML = `
      <div id="feed"><div data-urn="urn:li:activity:1">${REAL_POST}${COMMENTS}</div></div>`;

    const post = extractPost(document.querySelector<HTMLElement>("[data-urn]")!)!;

    expect(post.text).toContain("310ms");
    expect(post.text).not.toContain("Saving this for later");
    expect(post.author).toBe("Ana Ruiz");
  });

  it("finds the post even when the comments sit outside its container", () => {
    // The author-link budget can stop the post container short of the comments,
    // which is exactly when they get discovered on their own.
    document.body.innerHTML = `
      <div id="feed">
        <div data-urn="urn:li:activity:1">${REAL_POST}</div>
        ${COMMENTS}
      </div>`;

    const posts = findPosts(document.body);

    expect(posts).toHaveLength(1);
    expect(posts[0]!.getAttribute("data-urn")).toBe("urn:li:activity:1");
  });

  it("does not let a comment URN vouch for a comment", () => {
    document.body.innerHTML = `
      <article data-id="urn:li:comment:(urn:li:activity:1,99)">
        <a href="/in/dana-lee/">Dana Lee</a><span>${"Short comment body here. ".repeat(4)}</span>
      </article>`;
    expect(looksLikePost(document.querySelector("article")!)).toBe(false);
  });

  it("still accepts a real post URN", () => {
    document.body.innerHTML = `
      <div data-urn="urn:li:activity:1">${REAL_POST}</div>`;
    expect(looksLikePost(document.querySelector("[data-urn]")!)).toBe(true);
  });
});

describe("selector-matched discovery", () => {
  it("drops matched elements that are not posts", () => {
    document.body.innerHTML = `
      <div id="feed">
        <article id="real">
          <a href="/in/ana/">Ana</a><p>${body("A")}</p>
        </article>
        <article id="ad"><p>Promoted. Try our product today.</p></article>
      </div>`;

    const ids = findPosts(document.body).map((p) => p.id);

    expect(ids).toContain("real");
    expect(ids).not.toContain("ad");
  });
});

/**
 * The shape from the live feed, reproduced.
 *
 * A post with 159 comments, one of which ("Abhishek Shukla") was being listed
 * in the panel as a post of its own. The comment classes here deliberately
 * contain no substring the blocklist in `dom-text.ts` matches — that is the
 * whole point. Discovery has to reject it on position alone: it lives inside a
 * post card, so it is not one.
 */
describe("a comment with no recognisable class name", () => {
  const CARD = `
    <div class="feed-shared-update-v2" data-urn="urn:li:activity:7100">
      <div class="update-components-actor"><a href="/in/ana-ruiz/">Ana Ruiz</a></div>
      <div class="update-components-text">Paying with a card hurts less than paying with cash, and the bid data shows it: participants bid roughly twice as much when the payment was abstracted away.</div>
      <div class="Xk2Qp"><span>767</span><span>159 comments • 6 reposts</span></div>
      <div class="Zt9Lm">
        <article class="Qr4Vb" data-id="urn:li:comment:(urn:li:activity:7100,99)">
          <a href="/in/abhishek-shukla/"><span>Abhishek Shukla</span></a>
          <span>This is such an interesting example of how psychology quietly shapes everyday decisions, and it lines up with what I have seen elsewhere.</span>
        </article>
        <article class="Qr4Vb">
          <a href="/in/bill-gates/" aria-label="Bill Gates' profile"><img src="x.png"></a>
          <span>A genuinely useful framing of the problem, thanks for writing it up so clearly.</span>
        </article>
      </div>
    </div>`;

  it("lists the post once and neither commenter", () => {
    document.body.innerHTML = `<div id="feed">${CARD}</div>`;

    const posts = findPosts(document.body);

    expect(posts).toHaveLength(1);
    expect(posts[0]!.getAttribute("data-urn")).toBe("urn:li:activity:7100");
  });

  it("rejects the comment on its own", () => {
    document.body.innerHTML = `<div id="feed">${CARD}</div>`;
    expect(looksLikePost(document.querySelector("article")!)).toBe(false);
  });

  it("does not attribute the post to somebody in the thread", () => {
    document.body.innerHTML = `<div id="feed">${CARD}</div>`;
    const post = extractPost(findPosts(document.body)[0]!)!;

    expect(post.author).toBe("Ana Ruiz");
    expect(post.text).toContain("bid roughly twice as much");
    expect(post.text).not.toContain("Abhishek");
  });

  it("keeps two such posts apart", () => {
    document.body.innerHTML = `<div id="feed">${CARD}${CARD.replace("7100", "7101")}</div>`;
    expect(findPosts(document.body)).toHaveLength(2);
  });
});

describe("post cards outrank every heuristic", () => {
  it("ignores a sidebar module once a real card is on the page", () => {
    // "People you may know" clears the text floor and carries author links, so
    // the heuristics say yes. Containment says it is not a post card, and on a
    // page that has post cards, containment is the only thing asked.
    document.body.innerHTML = `
      <div id="page">
        <aside id="pymk">
          <a href="/in/dana-lee/">Dana Lee</a><a href="/in/erik-moss/">Erik Moss</a>
          <p>People you may know from Somewhere Inc., based on your profile and activity.</p>
        </aside>
        <div class="feed-shared-update-v2" data-urn="urn:li:activity:1">
          <a href="/in/ana-ruiz/">Ana Ruiz</a>
          <div class="update-components-text">${"A real post body with enough text to clear the floor. ".repeat(3)}</div>
        </div>
      </div>`;

    const posts = findPosts(document.body);

    expect(posts).toHaveLength(1);
    expect(posts[0]!.getAttribute("data-urn")).toBe("urn:li:activity:1");
  });

  it("returns the outer card of a reshare, not both", () => {
    document.body.innerHTML = `
      <div class="feed-shared-update-v2" data-urn="urn:li:activity:1">
        <a href="/in/ana-ruiz/">Ana Ruiz</a><span>Worth reading.</span>
        <div data-urn="urn:li:share:2">
          <a href="/in/ben-shah/">Ben Shah</a>
          <div class="update-components-text">${"The original post body goes here. ".repeat(4)}</div>
        </div>
      </div>`;

    const posts = findPosts(document.body);

    expect(posts).toHaveLength(1);
    expect(posts[0]!.getAttribute("data-urn")).toBe("urn:li:activity:1");
  });

  it("still finds posts on a page with no recognisable card at all", () => {
    // The redesign case. Tier 1 finds nothing, so the heuristics get their say.
    document.body.innerHTML = `<div id="feed">${postCard("ana", "A")}${postCard("ben", "B")}</div>`;
    expect(findPosts(document.body)).toHaveLength(2);
  });
});

/**
 * The feed LinkedIn is shipping now: every class hashed, no `data-urn` and no
 * `data-id` anywhere. `diagnose()` on the live feed returned
 * `{ cardsOnPage: 0, feedRoot: "main._9b4b878a", urn: null }` for every row —
 * so there is no name and no attribute left to match a post container on, and
 * the only thing left that LinkedIn cannot obfuscate is the shape of the list.
 *
 * The comment thread here is the trap: with 185 comments loaded it has more
 * children than the feed has posts, so any "pick the parent with the most
 * post-shaped children" rule picks the thread and lists every commenter.
 */
describe("a feed with no class names and no URNs", () => {
  /** One post: byline, body, action bar, and a comment thread under it. */
  function opaquePost(author: string, marker: string, commenters: string[]): string {
    const comments = commenters
      .map(
        (name) => `
        <div class="_${name}f3">
          <a href="/in/${name}/"><span>${name} Verified Profile 3rd+${name}</span></a>
          <span>${`A comment from ${name} that is easily long enough to pass for a post body on its own. `.repeat(2)}</span>
        </div>`,
      )
      .join("");

    return `
      <div class="_c81aa2f1">
        <div class="_1f9de2b0"><a href="/in/${author}/"><span>${author}</span></a>
          <span>Founder @ Somewhere</span></div>
        <div class="_7ba0d19c"><span>${body(marker)}</span></div>
        <div class="_44e0cc31"><button>Like</button><button>Comment</button>
          <button>Repost</button><button>Send</button></div>
        <div class="_9de71b04">${comments}</div>
      </div>`;
  }

  const FEED = `
    <main class="_9b4b878a">
      <div class="_0a1b2c3d">
        ${opaquePost("ana", "A", ["ayush", "dana", "erik", "farah", "gita"])}
        ${opaquePost("ben", "B", ["hari"])}
        ${opaquePost("cara", "C", [])}
      </div>
    </main>`;

  beforeEach(() => {
    document.body.innerHTML = FEED;
  });

  it("returns the three posts and none of the six commenters", () => {
    const posts = findPosts(document.querySelector("main")!);

    expect(posts).toHaveLength(3);
    for (const post of posts) {
      expect(post.className).toBe("_c81aa2f1");
    }
  });

  it("is not fooled by a thread with more comments than the feed has posts", () => {
    // The five-comment thread is the largest sibling group on the page. It is
    // also deeper than the feed list, which is the only reason this works.
    const posts = findPosts(document.querySelector("main")!);
    const names = posts.map((p) => p.querySelector("a")!.getAttribute("href"));

    expect(names).toEqual(["/in/ana/", "/in/ben/", "/in/cara/"]);
  });

  it("attributes each post to its poster, not to a commenter", () => {
    const posts = findPosts(document.querySelector("main")!);
    expect(extractPost(posts[0]!)!.author).toBe("ana");
  });

  it("scores the post body, not the comment thread under it", () => {
    const post = extractPost(findPosts(document.querySelector("main")!)[0]!)!;
    expect(post.text).toContain("310ms");
    expect(post.text).not.toContain("A comment from");
  });

  it("rejects a comment offered on its own", () => {
    const comment = document.querySelector<HTMLElement>("._ayushf3")!;
    expect(findPosts(document.querySelector("main")!)).not.toContain(comment);
  });
});

/**
 * Action-bar boundary: comments are excluded by position, not class name.
 *
 * On the hashed-class feed there is no `[class*='comment']` to match. The
 * reliable separator is the action bar (Like / Comment / Repost / Send buttons),
 * which always sits between the post body and the comment thread. Anything in
 * document order after the action bar is in the comment region.
 */
describe("action-bar boundary excludes commenters on hashed-class feed", () => {
  // A post card with fully hashed class names, an action bar, and a comment
  // section. No class name contains the word "comment".
  function hashedCard(author: string, bodyText: string, commenters: string[]): string {
    const comments = commenters
      .map(
        (name) => `
        <div class="_cf3a">
          <a href="/in/${name}/"><span>${name}</span></a>
          <span>A thoughtful comment from ${name} that is long enough to qualify. A thoughtful comment from ${name} that is long enough to qualify.</span>
        </div>`,
      )
      .join("");

    return `
      <div class="_c81a" data-urn="urn:li:activity:${author}">
        <div class="_1f9d"><a href="/in/${author}/"><span>${author}</span></a></div>
        <div class="_7ba0">${bodyText}</div>
        <div class="_44e0">
          <button>Like</button>
          <button>Comment</button>
          <button>Repost</button>
          <button>Send</button>
        </div>
        <div class="_9de7">${comments}</div>
      </div>`;
  }

  const BODY = "We cut p99 latency from 2.4s to 310ms by batching the lookup query and adding a partial index on events. This is a substantial change that had real impact on user experience.";

  it("does not list commenters as posts when post has named URN", () => {
    document.body.innerHTML = `
      <div id="feed">
        ${hashedCard("ana", BODY, ["dana", "erik", "farah"])}
        ${hashedCard("ben", BODY, ["gita"])}
      </div>`;

    const posts = findPosts(document.getElementById("feed")!);

    expect(posts).toHaveLength(2);
    expect(posts.map((p) => p.getAttribute("data-urn"))).toEqual([
      "urn:li:activity:ana",
      "urn:li:activity:ben",
    ]);
  });

  it("attributes each post to its author, not a commenter", () => {
    document.body.innerHTML = `
      <div id="feed">
        ${hashedCard("ana", BODY, ["dana", "erik"])}
      </div>`;

    const post = extractPost(findPosts(document.getElementById("feed")!)[0]!)!;
    expect(post.author).toBe("ana");
    expect(post.text).toContain("310ms");
    expect(post.text).not.toContain("thoughtful comment");
  });
});

/**
 * Ranking the candidate lists. Each of these is a group that beat the real
 * feed list under some plausible metric, and each one was observed: the
 * comment thread on the live feed, the two-child wrapper on the live feed
 * after the first fix.
 */
describe("choosing which list is the feed", () => {
  function item(name: string, size: number): string {
    return `<div class="_item"><a href="/in/${name}/">${name}</a>
      <span>${`Post body text for ${name}. `.repeat(size)}</span></div>`;
  }

  it("prefers the feed list over a shallower two-child wrapper", () => {
    // The live-feed regression: the wrapper is one level up, so "shallowest
    // wins" returned two posts on a feed showing six.
    document.body.innerHTML = `
      <main>
        <div id="chrome">
          ${item("promoA", 4)}
          ${item("promoB", 4)}
          <div id="feed">
            ${item("ana", 12)}${item("ben", 12)}${item("cara", 12)}
            ${item("dev", 12)}${item("eve", 12)}${item("fay", 12)}
          </div>
        </div>
      </main>`;

    const posts = findPosts(document.querySelector("main")!);

    expect(posts).toHaveLength(6);
    expect(posts[0]!.querySelector("a")!.getAttribute("href")).toBe("/in/ana/");
  });

  it("prefers the feed list over a comment thread with more children", () => {
    document.body.innerHTML = `
      <main>
        <div id="feed">
          <div class="_item">
            <a href="/in/ana/">ana</a><span>${"Post body. ".repeat(12)}</span>
            <div id="thread">
              ${item("c1", 3)}${item("c2", 3)}${item("c3", 3)}
              ${item("c4", 3)}${item("c5", 3)}
            </div>
          </div>
          ${item("ben", 12)}${item("cara", 12)}
        </div>
      </main>`;

    const posts = findPosts(document.querySelector("main")!);

    expect(posts).toHaveLength(3);
    expect(posts.map((p) => p.querySelector("a")!.getAttribute("href"))).toEqual([
      "/in/ana/",
      "/in/ben/",
      "/in/cara/",
    ]);
  });

  it("rejects a group whose text is really all one child", () => {
    // A wrapper around the list: two children, one of which is the list.
    document.body.innerHTML = `
      <main>
        <div id="wrapper">
          ${item("sidebar", 1)}
          <div id="feed">${item("ana", 10)}${item("ben", 10)}${item("cara", 10)}</div>
        </div>
      </main>`;

    const posts = findPosts(document.querySelector("main")!);

    expect(posts).toHaveLength(3);
    expect(posts.some((p) => p.id === "feed")).toBe(false);
  });

  it("does not drop a feed where one post is much longer than the rest", () => {
    // A viral post of ~3 000 characters alongside two short posts gives
    // topShare ≈ 0.94. With the old 0.80 cap this group was filtered out as
    // lopsided and the feed showed nothing.
    document.body.innerHTML = `
      <main>
        <div id="feed">
          ${item("viral", 130)}
          ${item("short1", 3)}
          ${item("short2", 3)}
        </div>
      </main>`;

    const posts = findPosts(document.querySelector("main")!);

    expect(posts).toHaveLength(3);
    expect(posts[0]!.querySelector("a")!.getAttribute("href")).toBe("/in/viral/");
  });
});

/**
 * The feed LinkedIn actually ships, reproduced from a live session.
 *
 * Captured 2026-09-16 from `/feed/` and from a post permalink. Every class is
 * hashed, and there is no `data-urn`, `data-id`, `role="article"` or `<article>`
 * anywhere in the feed — `POST_CONTAINER` and the broad `POST_SELECTOR` both
 * matched exactly zero elements on the live page. What remains is the
 * visually-hidden `<h2>` that opens each card.
 *
 * These are written against that shape rather than against readable class names,
 * because markup with readable class names is what every previous version of
 * this file passed against while failing on the feed.
 */
describe("heading-anchored discovery (live feed shape)", () => {
  /** A post card as the current feed renders it: hidden h2 first, then content. */
  function headedCard(author: string, marker: string): string {
    return `
      <div class="_c90385f9">
        <h2 class="_170ff3a8"><span>Feed post</span></h2>
        <div class="_a1"><a href="/in/${author}/"><span>${author}</span></a>
          <span>Staff Engineer at Somewhere</span></div>
        <div class="_a2"><span>${body(marker)}</span></div>
      </div>`;
  }

  /** A comment: author link and a body, but no heading of its own. */
  function comment(author: string, text: string): string {
    return `
      <div class="_b1">
        <div class="_b2"><a href="/in/${author}/"><span>${author}</span></a>
          <span>Software Engineer at Elsewhere</span></div>
        <div class="_b3"><span>${text}</span></div>
        <button>Like</button><button>Reply</button>
      </div>`;
  }

  it("finds every post on the feed and no commenters", () => {
    document.body.innerHTML = `
      <main class="_9b4b878a">
        <div class="_06cf158a">
          ${headedCard("ana-ruiz", "A")}
          ${headedCard("ben-shah", "B")}
          ${headedCard("cara-diaz", "C")}
        </div>
      </main>`;

    const posts = findPosts(document.querySelector("main")!);
    expect(posts).toHaveLength(3);
    for (const post of posts) {
      expect(post.querySelector("h2")).not.toBeNull();
    }
  });

  it("does not list a commenter as a post", () => {
    document.body.innerHTML = `
      <main class="_9b4b878a">
        <div class="_06cf158a">
          <div class="_c90385f9">
            <h2 class="_170ff3a8"><span>Feed post</span></h2>
            <div class="_a1"><a href="/in/ana-ruiz/"><span>Ana Ruiz</span></a></div>
            <div class="_a2"><span>${body("A")}</span></div>
            <div class="_cmts">
              ${comment("ben-shah", "Congratulations! Well deserved, great to see this.")}
              ${comment("cara-diaz", "Amazing work here, thanks for sharing all of it.")}
            </div>
          </div>
        </div>
      </main>`;

    const posts = findPosts(document.querySelector("main")!);
    expect(posts).toHaveLength(1);
    expect(posts[0]!.textContent).toContain("Ana Ruiz");
  });

  /**
   * The failure that prompted this tier.
   *
   * On `/feed/update/urn:li:activity:.../` the previous ranking returned ten
   * items, every one of them a comment and none of them the post. It ranks
   * candidate lists by total text, and a post's comment thread always holds
   * more text than the post — so no threshold could have fixed it.
   */
  it("returns the post, not the thread, on a permalink page", () => {
    const comments = Array.from({ length: 10 }, (_, i) =>
      comment(`commenter-${i}`, `Congratulations! This is comment number ${i} and it runs long enough to qualify as an item on its own.`),
    ).join("");

    document.body.innerHTML = `
      <main class="_9b4b878a">
        <div class="_06cf158a">
          <div class="_c90385f9">
            <h2 class="_170ff3a8"><span>Feed post</span></h2>
            <div class="_a1"><a href="/in/arghya-roy/"><span>Arghya Roy</span></a></div>
            <div class="_a2"><span>${body("permalink")}</span></div>
            <div class="_cmts">${comments}</div>
          </div>
        </div>
      </main>`;

    const posts = findPosts(document.querySelector("main")!);
    expect(posts).toHaveLength(1);
    expect(posts[0]!.textContent).toContain("Arghya Roy");
  });

  /**
   * A permalink card measured 17 751 characters live, because it legitimately
   * contains its whole comment thread. `MAX_ITEM_TEXT` is 8 000, so any tier
   * that applies it rejects the only real post on the page.
   */
  it("keeps a card whose thread pushes it past the list-item text cap", () => {
    const filler = "Thanks for sharing, this is a genuinely useful breakdown. ".repeat(200);
    document.body.innerHTML = `
      <main class="_9b4b878a">
        <div class="_c90385f9">
          <h2 class="_170ff3a8"><span>Feed post</span></h2>
          <div class="_a1"><a href="/in/ana-ruiz/"><span>Ana Ruiz</span></a></div>
          <div class="_a2"><span>${body("big")}</span></div>
          <div class="_cmts"><span>${filler}</span></div>
        </div>
      </main>`;

    const main = document.querySelector("main")!;
    expect(main.textContent!.length).toBeGreaterThan(8000);
    expect(findPosts(main)).toHaveLength(1);
  });

  /**
   * The rule is keyed on shape, not on the words "Feed post" — that string is
   * user-visible text LinkedIn translates and can reword, and matching it would
   * repeat the `[class*='comment']` mistake: silent failure into the tier that
   * lists commenters.
   */
  it("works on a non-English feed", () => {
    document.body.innerHTML = `
      <main class="_9b4b878a">
        <div class="_06cf158a">
          ${headedCard("ana-ruiz", "A").replace("Feed post", "Publicación del feed")}
          ${headedCard("ben-shah", "B").replace("Feed post", "Publicación del feed")}
        </div>
      </main>`;

    expect(findPosts(document.querySelector("main")!)).toHaveLength(2);
  });

  /**
   * LinkedIn ships headings inside overflow menus ("Ad Options", "Don't want to
   * see this"). Live, their parents held 10 and 22 characters, so the text floor
   * removes them without naming them.
   */
  it("ignores headings on containers too small to be a post", () => {
    document.body.innerHTML = `
      <main class="_9b4b878a">
        <div class="_06cf158a">
          ${headedCard("ana-ruiz", "A")}
          <div class="_menu"><h2>Ad Options</h2><a href="/in/x/">x</a></div>
          <div class="_menu2"><h2>Don’t want to see this</h2><a href="/in/y/">y</a></div>
        </div>
      </main>`;

    expect(findPosts(document.querySelector("main")!)).toHaveLength(1);
  });

  /** A heading partway down a card is content, not the card's landmark. */
  it("requires the heading to open the card", () => {
    document.body.innerHTML = `
      <main class="_9b4b878a">
        <div class="_06cf158a">
          <div class="_c90385f9">
            <div class="_a1"><a href="/in/ana-ruiz/"><span>Ana Ruiz</span></a></div>
            <h2>A heading in the middle of a body</h2>
            <div class="_a2"><span>${body("A")}</span></div>
          </div>
        </div>
      </main>`;

    const posts = findPosts(document.querySelector("main")!);
    for (const post of posts) {
      expect(post.className).not.toBe("_c90385f9");
    }
  });

  /** A reshare nests a card in a card; the outer one is the whole post. */
  it("takes the outermost card when a reshare nests one", () => {
    document.body.innerHTML = `
      <main class="_9b4b878a">
        <div class="_c90385f9">
          <h2><span>Feed post</span></h2>
          <div class="_a1"><a href="/in/ana-ruiz/"><span>Ana Ruiz</span></a></div>
          <div class="_a2"><span>${body("outer")}</span></div>
          <div class="_c90385f9">
            <h2><span>Feed post</span></h2>
            <div class="_a1"><a href="/in/ben-shah/"><span>Ben Shah</span></a></div>
            <div class="_a2"><span>${body("inner")}</span></div>
          </div>
        </div>
      </main>`;

    const posts = findPosts(document.querySelector("main")!);
    expect(posts).toHaveLength(1);
    expect(posts[0]!.textContent).toContain("Ana Ruiz");
  });
});
