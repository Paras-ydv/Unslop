/**
 * Phrase lists used by the linguistic and engagement-bait detectors.
 *
 * Kept separate from detection logic so they can be tuned without touching
 * code. Every entry is lowercase; matching is case-insensitive.
 *
 * A phrase earns a place here only if it is *disproportionately* common in
 * low-value posts. Words that merely appear often in business writing ("team",
 * "growth", "strategy") are not signals — they occur just as often in good
 * posts, and including them would punish the topic rather than the writing.
 */

/**
 * Openers that announce a lesson is coming rather than delivering one.
 * Nearly always the first line of a templated post.
 */
export const HOOK_OPENERS = [
  "here's the thing",
  "here's the truth",
  "here's what nobody tells you",
  "here's what i learned",
  "nobody talks about this",
  "let me explain",
  "let that sink in",
  "read that again",
  "i'll say it louder",
  "unpopular opinion",
  "hot take",
  "controversial take",
  "plot twist",
  "but here's the kicker",
  "and then it hit me",
  "little did i know",
  "what happened next",
  "you won't believe",
  "this changed everything",
  "i was today years old",
];

/**
 * Inflated significance claims. These assert importance instead of
 * demonstrating it.
 */
export const HYPERBOLE = [
  "game changer",
  "game-changer",
  "mind blowing",
  "mind-blowing",
  "life changing",
  "life-changing",
  "revolutionary",
  "groundbreaking",
  "paradigm shift",
  "the future of",
  "will never be the same",
  "changed my life",
  "single most important",
  "absolute must",
  "brutal truth",
  "harsh truth",
  "hard truth",
  "wake up call",
];

/**
 * Corporate abstraction — phrases that fill space without adding information.
 * Heavy use correlates with posts that say nothing concrete.
 */
export const CORPORATE_FILLER = [
  "at the end of the day",
  "moving forward",
  "circle back",
  "low hanging fruit",
  "move the needle",
  "boil the ocean",
  "drink the kool-aid",
  "take it to the next level",
  "think outside the box",
  "hit the ground running",
  "synergy",
  "leverage our",
  "best in class",
  "world class",
  "cutting edge",
  "thought leader",
  "thought leadership",
  "value add",
  "deep dive",
  "north star",
  "double down",
  "table stakes",
];

/**
 * LLM-favored connective and framing vocabulary.
 *
 * Individually innocent — the signal is density, not presence. One "moreover"
 * means nothing; four in a short post is a strong tell.
 */
export const LLM_TELLS = [
  "delve",
  "delving",
  "moreover",
  "furthermore",
  "in today's fast-paced",
  "in today's digital",
  "ever-evolving",
  "rapidly evolving",
  "it's worth noting",
  "it is worth noting",
  "navigating the",
  "unlock the power",
  "unlock your",
  "harness the power",
  "embark on",
  "testament to",
  "underscores the",
  "highlights the importance",
  "plays a crucial role",
  "plays a vital role",
  "is key to unlocking",
  "in conclusion",
  "to sum up",
];

/**
 * Explicit requests for engagement. The defining feature of comment-farming.
 */
export const ENGAGEMENT_CTA = [
  "agree?",
  "thoughts?",
  "am i wrong",
  "who's with me",
  "whos with me",
  "raise your hand",
  "drop a comment",
  "comment below",
  "let me know in the comments",
  "tell me in the comments",
  "share your thoughts",
  "what do you think?",
  "repost if",
  "share if you agree",
  "like if you agree",
  "double tap if",
  "tag someone who",
  "tag a friend",
  "follow for more",
  "follow me for",
  "save this post",
  "bookmark this",
  "dm me",
  "comment \"yes\"",
  "comment yes",
  "type \"yes\"",
  "link in comments",
  "link in the comments",
];

/**
 * Credibility-borrowing openers that frame the post as insider knowledge.
 */
export const AUTHORITY_BAIT = [
  "after 10 years",
  "after 15 years",
  "after 20 years",
  "in my 20 years",
  "i've interviewed",
  "i've hired",
  "i've managed",
  "i've coached",
  "having worked with",
  "as someone who",
  "i've seen it all",
  "trust me on this",
  "take it from someone",
];

/**
 * Bullet glyphs and decorative markers used to fake structure.
 * Matched as characters, not phrases.
 */
export const BULLET_GLYPHS = [
  "→",
  "➡",
  "➜",
  "⮕",
  "•",
  "●",
  "◆",
  "▪",
  "▶",
  "✅",
  "✔",
  "☑",
  "🔹",
  "🔸",
  "👉",
  "💡",
  "⚡",
  "🚀",
  "✨",
  "🔥",
  "💪",
  "🎯",
  "📌",
  "⭐",
  "‣",
  "▸",
  "-",
  "—",
  "*",
];

/**
 * Vague quantity words. Used in place of actual numbers, and a direct
 * counter-signal to informational density.
 */
export const VAGUE_QUANTIFIERS = [
  "many",
  "most",
  "some",
  "several",
  "numerous",
  "countless",
  "a lot of",
  "tons of",
  "plenty of",
  "various",
  "multiple",
  "significant",
  "substantial",
  "considerable",
];

/** Every content lexicon, for aggregate counting. */
export const ALL_PHRASE_LEXICONS = {
  hookOpeners: HOOK_OPENERS,
  hyperbole: HYPERBOLE,
  corporateFiller: CORPORATE_FILLER,
  llmTells: LLM_TELLS,
  engagementCta: ENGAGEMENT_CTA,
  authorityBait: AUTHORITY_BAIT,
} as const;

export type LexiconName = keyof typeof ALL_PHRASE_LEXICONS;
