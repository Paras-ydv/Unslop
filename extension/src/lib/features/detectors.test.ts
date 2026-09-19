import { describe, expect, it } from "vitest";
import { extractEngagementBait } from "./engagement-bait";
import { extractInformational } from "./informational";
import { extractLinguistic } from "./linguistic";
import { extractStructural } from "./structural";
import { analyzeText, saturate, startsWithBullet, stdDev } from "./text-utils";
import { BULLET_GLYPHS } from "./lexicons";

const structural = (text: string) => extractStructural(analyzeText(text));
const linguistic = (text: string) => extractLinguistic(analyzeText(text));
const informational = (text: string, links = 0) =>
  extractInformational(analyzeText(text), { linkCount: links });
const bait = (text: string) => extractEngagementBait(analyzeText(text));

describe("text-utils", () => {
  it("saturates toward 1 without exceeding it", () => {
    expect(saturate(0, 2)).toBe(0);
    expect(saturate(2, 2)).toBeCloseTo(0.632, 2);
    expect(saturate(100, 2)).toBeLessThanOrEqual(1);
    expect(saturate(100, 2)).toBeGreaterThan(0.99);
  });

  it("returns zero std-dev for fewer than two values", () => {
    expect(stdDev([])).toBe(0);
    expect(stdDev([5])).toBe(0);
  });

  it("computes population std-dev", () => {
    expect(stdDev([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(2, 5);
  });

  it("treats a bare hyphen as a bullet only when followed by a space", () => {
    expect(startsWithBullet("- a list item", BULLET_GLYPHS)).toBe(true);
    expect(startsWithBullet("-5% churn this month", BULLET_GLYPHS)).toBe(false);
  });

  it("treats emoji glyphs as bullets without requiring a space", () => {
    expect(startsWithBullet("🚀Growth", BULLET_GLYPHS)).toBe(true);
  });

  it("tokenizes words with apostrophes and hyphens intact", () => {
    expect(analyzeText("don't re-run it").words).toEqual(["don't", "re-run", "it"]);
  });
});

describe("structural", () => {
  it("scores a full emoji-bullet list near 1", () => {
    const f = structural("🚀 One\n✅ Two\n💡 Three\n🔥 Four");
    expect(f.bulletLineRatio).toBe(1);
    expect(f.emojiDensity).toBeGreaterThan(0.5);
  });

  it("scores flowing prose near 0 on bullets", () => {
    const f = structural(
      "We cut latency from 2.4s to 310ms by batching a permissions query that was issuing one round trip per resource in the response payload.",
    );
    expect(f.bulletLineRatio).toBe(0);
    expect(f.emojiDensity).toBe(0);
  });

  it("detects a short hook line followed by a blank line", () => {
    const f = structural("I got rejected 47 times.\n\nThen everything changed.\n\nHere is why.");
    expect(f.hookPattern).toBeGreaterThan(0.7);
  });

  it("does not fire the hook pattern without a blank second line", () => {
    const f = structural("I got rejected 47 times.\nThen everything changed.");
    expect(f.hookPattern).toBe(0);
  });

  it("detects typographic shouting", () => {
    const f = structural("THIS IS HUGE\nAI changes everything!!");
    expect(f.shoutingRatio).toBe(1);
  });

  it("does not treat short acronyms as shouting", () => {
    const f = structural("We moved to AWS last quarter and it went fine.");
    expect(f.shoutingRatio).toBe(0);
  });

  it("detects a shouted word inside an ordinary line", () => {
    // The whole-line rule alone missed this, which is how shouting actually
    // appears — one word for emphasis, not an entire capitalised line.
    const f = structural("AI will change EVERYTHING about how we work.");
    expect(f.shoutingRatio).toBe(1);
  });

  it("detects short emphasis words that are never acronyms", () => {
    expect(structural("And most people are NOT ready.").shoutingRatio).toBe(1);
    expect(structural("You must NEVER do this to a database.").shoutingRatio).toBe(1);
  });

  it("does not read a technical post as shouting", () => {
    // The expensive false positive: acronym-dense writing is exactly the
    // substantive content the informational weights exist to defend.
    const f = structural(
      "We migrated the API from REST to gRPC and cut p99 from 840ms to 120ms.\n" +
        "The SQL plan showed a missing index; our CTO signed off. CI/CD runs on AWS ECS with JSON over HTTP.",
    );
    expect(f.shoutingRatio).toBe(0);
  });

  it("counts a shout that closes with a pointer emoji", () => {
    // `[!?]{2,}$` anchored at the raw end, so every line closing with the
    // pointer emoji slop reliably appends went uncounted.
    const f = structural("Tag someone who needs to see this!! \u{1F447}");
    expect(f.shoutingRatio).toBe(1);
  });

  it("scores uniform line lengths as templated", () => {
    const f = structural("Ship fast today\nLearn faster now\nRepeat it again\nKeep on going");
    expect(f.lineUniformity).toBeGreaterThan(0.6);
  });

  it("returns zeroed features for empty text", () => {
    const f = structural("");
    expect(f.bulletLineRatio).toBe(0);
    expect(f.hookPattern).toBe(0);
    expect(f.lineUniformity).toBe(0);
  });
});

describe("linguistic", () => {
  it("matches stock opening phrases", () => {
    const f = linguistic("Here's the thing: nobody talks about this.");
    expect(f.hookOpeners).toBeGreaterThan(0.5);
    expect(f.matchedPhrases).toContain("here's the thing");
  });

  it("matches hyperbole and corporate filler separately", () => {
    const f = linguistic("This is a game changer. At the end of the day, we move the needle.");
    expect(f.hyperbole).toBeGreaterThan(0);
    expect(f.corporateFiller).toBeGreaterThan(0.5);
  });

  it("detects LLM connective vocabulary", () => {
    const f = linguistic(
      "Moreover, in today's fast-paced world, it's worth noting that this plays a crucial role.",
    );
    expect(f.llmTells).toBeGreaterThan(0.8);
  });

  it("detects antithesis framing", () => {
    expect(linguistic("It's not about the money. It's about the people.").antithesis)
      .toBeGreaterThan(0.5);
    expect(linguistic("Stop overthinking. Start shipping.").antithesis)
      .toBeGreaterThan(0.5);
  });

  it("detects tricolon runs of short parallel fragments", () => {
    expect(linguistic("Ship fast. Learn faster. Repeat.").tricolon).toBeGreaterThan(0.5);
  });

  it("counts a one-word closer as a tricolon beat", () => {
    // "Repeat." / "Period." are the strongest form of the third beat, so the
    // run must not break on a single-word fragment.
    expect(linguistic("Build it. Ship it. Done.").tricolon).toBeGreaterThan(0.5);
  });

  it("does not fire tricolon on ordinary prose", () => {
    const f = linguistic(
      "We removed the account creation step before payment and completion rose from 61 percent to 74 percent over three weeks.",
    );
    expect(f.tricolon).toBe(0);
  });

  it("stays quiet on clean technical writing", () => {
    const f = linguistic(
      "Connection pool sizing was the second issue. We ran 20 connections against an instance that handles 200, so requests queued at the pool rather than the database.",
    );
    expect(f.hookOpeners).toBe(0);
    expect(f.hyperbole).toBe(0);
    expect(f.llmTells).toBe(0);
    expect(f.matchedPhrases).toEqual([]);
  });
});

describe("informational", () => {
  it("scores concrete numbers highly", () => {
    const f = informational("Latency fell from 2.4s to 310ms across 8,000 sessions, up 11%.");
    expect(f.numberDensity).toBeGreaterThan(0.6);
  });

  it("ignores list numbering as information", () => {
    const listed = informational("Habits:\n1. Wake early\n2. Read daily\n3. Exercise often");
    expect(listed.numberDensity).toBeLessThan(0.3);
  });

  it("detects named entities", () => {
    const f = informational("Postgres 15 and pgloader handled the Figma migration.");
    expect(f.entityDensity).toBeGreaterThan(0.3);
  });

  it("does not count sentence-initial function words as entities", () => {
    const f = informational("The team shipped it. We were happy. This was good. They agreed.");
    expect(f.entityDensity).toBeLessThan(0.3);
  });

  it("does not count sentence-initial imperative verbs as entities", () => {
    // Slop is written in imperatives; counting these inflated exactly the class
    // this counter-signal is meant to argue against.
    expect(informational("Ship fast. Learn faster. Repeat.").entityDensity).toBe(0);
    expect(informational("Agree? Repost if you think so.").entityDensity).toBe(0);
    expect(informational("Stop overthinking. Start shipping.").entityDensity).toBe(0);
  });

  it("still counts multi-word and acronym entities at a sentence start", () => {
    expect(informational("Stack Overflow published the survey.").entityDensity)
      .toBeGreaterThan(0);
    expect(informational("AWS raised its prices again this year.").entityDensity)
      .toBeGreaterThan(0);
  });

  it("does not read shouting as a run of acronyms", () => {
    expect(informational("THIS IS A GAME CHANGER").entityDensity).toBe(0);
  });

  it("penalizes vague quantifiers", () => {
    const f = informational("Many teams saw significant gains and several noticed a lot of value.");
    expect(f.vagueness).toBeGreaterThan(0.6);
    expect(f.numberDensity).toBe(0);
  });

  it("counts outbound links as citations", () => {
    expect(informational("Worth a read.", 1).citationDensity).toBeGreaterThan(0.5);
    expect(informational("Worth a read.", 0).citationDensity).toBe(0);
  });

  it("detects prescriptive advice framing", () => {
    const f = informational("You should always ship early. Here's how to do it. Never underestimate scope.");
    expect(f.prescriptiveness).toBeGreaterThan(0.3);
  });

});

describe("engagement-bait", () => {
  it("scores an explicit CTA close near the maximum", () => {
    const f = bait("Great teams win.\n\nAgree? 👇 Repost if you think so.");
    expect(f.ctaPhrases).toBeGreaterThan(0.5);
    expect(f.closingHook).toBeGreaterThan(0.5);
    expect(f.pointerEmoji).toBeGreaterThan(0.5);
  });

  it("detects hashtag stuffing", () => {
    const f = bait("Big news.\n\n#leadership #growth #mindset #success #hiring");
    expect(f.hashtagDensity).toBeGreaterThan(0.7);
  });

  it("detects credential-leading openers", () => {
    expect(bait("After 20 years in tech, here is what I know.").authorityBait)
      .toBeGreaterThan(0.5);
  });

  it("leaves a genuine discussion question mostly alone", () => {
    const f = bait(
      "When a senior and a junior disagree in code review and both are defensible, do you step in?\n\nI have been stepping in less and I am unsure it is working.",
    );
    expect(f.ctaPhrases).toBe(0);
    expect(f.hashtagDensity).toBe(0);
    expect(f.pointerEmoji).toBe(0);
  });

  it("does not fire a closing hook on a plain statement ending", () => {
    const f = bait("We deleted the cache layer. Hit rate was 4%.");
    expect(f.closingHook).toBe(0);
  });
});
