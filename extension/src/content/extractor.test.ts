/**
 * Guards against the extractor scoring something that is not a single post.
 *
 * Two failures this protects against, both seen in the product rather than in
 * a test. First: a badge attached above the feed's "For you / Network" tabs,
 * having scored the whole page's text as one post — length bounds are the
 * backstop that makes that impossible regardless of which selector found the
 * element. Second, and more expensive: the first seven rows of real collected
 * labels contained two author bylines, a video player's caption-settings
 * dialog, a reaction counter, and the same post twice. Every fixture below
 * marked "captured" is that text verbatim.
 *
 * Bad rows in a training set are worse than bad verdicts on screen. A wrong
 * verdict is visible and transient; a byline rated 1 is indistinguishable from
 * a real judgment once it is in the file.
 */

import { describe, expect, it } from "vitest";
import { normalizeText, stripSeeMore } from "../lib/normalize";
import { isPostContent, MIN_TEXT_LENGTH, MAX_TEXT_LENGTH } from "./extractor";

/** The extractor's own accept/reject decision, minus the DOM. */
function accepted(raw: string): boolean {
  const { text } = stripSeeMore(normalizeText(raw));
  if (text.length < MIN_TEXT_LENGTH) return false;
  if (text.length > MAX_TEXT_LENGTH) return false;
  return isPostContent(text);
}

describe("post length bounds", () => {
  it("accepts an ordinary post", () => {
    expect(accepted("We cut p99 latency from 2.4s to 310ms by batching a query.")).toBe(true);
  });

  it("accepts a long but plausible post", () => {
    // LinkedIn's own limit is 3000 characters.
    expect(accepted("word ".repeat(560))).toBe(true);
  });

  it("rejects a whole feed's worth of text", () => {
    expect(accepted("Some post body. ".repeat(500))).toBe(false);
  });

  it("rejects chrome and empty containers", () => {
    expect(accepted("")).toBe(false);
    expect(accepted("Follow")).toBe(false);
    expect(accepted("2 comments")).toBe(false);
  });

  it("keeps genuinely short posts", () => {
    // The reason the length floor stayed at 12. Raising it to 40 read as a tidy
    // way to exclude chrome and in fact excluded a whole class of real post —
    // these are ordinary LinkedIn, not fragments. Short *and* not a post is the
    // chrome case, and that is what the content checks are for.
    expect(accepted("We shipped it. Finally.")).toBe(true);
    expect(accepted("Congratulations! Well deserved.")).toBe(true);
    expect(accepted("We're hiring! DM me if interested.")).toBe(true);
    expect(accepted("Anyone else seeing slow CI today?")).toBe(true);
  });

  it("measures the normalized length, not the raw length", () => {
    expect(accepted("  a  \n\n\n  b  ")).toBe(false);
  });
});

describe("rejecting text that is not a post", () => {
  it("rejects an author byline (captured)", () => {
    expect(
      accepted(
        "7M+ Impressions | Content creator| Ghostwriting | Helping founder to grow | Growth Intern | Social Media Marketing | Tech & AI",
      ),
    ).toBe(false);
  });

  it("rejects a credentials byline (captured)", () => {
    expect(
      accepted(
        "Building | Ex-Amazon | Ex-Square | IIT KGP | System Design Instructor at O’Reilly and Udemy",
      ),
    ).toBe(false);
  });

  it("rejects the video player's caption dialog (captured)", () => {
    expect(
      accepted(
        "Video Player is loading.\n\nCurrent Time 0:00\n\n/\n\nDuration 0:17\n\n" +
          "Stream Type LIVE\n\nThis is a modal window.\n\nText Edge StyleNoneRaisedDepressed",
      ),
    ).toBe(false);
  });

  it("rejects a reaction counter (captured)", () => {
    expect(
      accepted("Reyyi Shreyas and 44 others reacted\nReyyi Shreyas and 44 others\n\n2 comments\n2 comments"),
    ).toBe(false);
  });

  it("keeps a post that happens to use pipes", () => {
    // The byline rule must not eat real content. A post has sentences.
    expect(
      accepted(
        "Shipped the new pipeline today. The stages are: parse | validate | enrich | store. " +
          "Throughput went from 400/s to 2,600/s after we dropped the per-row transaction.",
      ),
    ).toBe(true);
  });

  it("keeps a post that mentions a video", () => {
    expect(
      accepted(
        "Recorded a short video walking through how we cut our build from 9 minutes to 100 seconds. " +
          "The short version: most of it was one unnecessary Docker layer rebuild.",
      ),
    ).toBe(true);
  });

  it("keeps a multi-line post whose first line is short", () => {
    expect(
      accepted("Three things broke this week.\n\nAll three were DNS. Every single one of them was DNS."),
    ).toBe(true);
  });
});

describe("the see-more affordance", () => {
  it("strips the bare '… more' form (captured)", () => {
    // The captured rows ended in "… more", which the "see"-only pattern left in
    // the text *and* reported as not truncated.
    const { text, truncated } = stripSeeMore("We're just getting started.\n\n#OpenSource\n… more");
    expect(text).toBe("We're just getting started.\n\n#OpenSource");
    expect(truncated).toBe(true);
  });

  it("still strips the '…see more' form", () => {
    const { text, truncated } = stripSeeMore("A post that goes on …see more");
    expect(text).toBe("A post that goes on");
    expect(truncated).toBe(true);
  });

  it("strips the plain-dots form", () => {
    expect(stripSeeMore("A post that goes on ...more").text).toBe("A post that goes on");
  });

  it("leaves a post that merely ends with the word more", () => {
    const body = "We need to ship more";
    expect(stripSeeMore(body).text).toBe(body);
    expect(stripSeeMore(body).truncated).toBe(false);
  });
});
