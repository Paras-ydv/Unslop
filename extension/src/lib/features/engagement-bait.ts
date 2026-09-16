/**
 * Engagement-bait detectors: explicit solicitation of reactions.
 *
 * This is the clearest case where slop and AI authorship come apart. A
 * hand-written post ending "Agree? 👇 Repost if this resonated" is pure
 * comment-farming and should score red regardless of who wrote it.
 */

import { AUTHORITY_BAIT, ENGAGEMENT_CTA } from "./lexicons";
import {
  countEmoji,
  countPhrases,
  ratio,
  saturate,
  type TextStats,
} from "./text-utils";

export interface EngagementBaitFeatures {
  /** Explicit CTA phrases, saturated count. 0–1. */
  ctaPhrases: number;
  /** Credibility-borrowing openers, saturated count. 0–1. */
  authorityBait: number;
  /** Rhetorical questions per 100 words, saturated. 0–1. */
  questionDensity: number;
  /** Whether the post closes with a question or CTA. 0–1. */
  closingHook: number;
  /** Downward-pointing emoji used to direct attention. 0–1. */
  pointerEmoji: number;
  /** Hashtag count, saturated. 0–1. */
  hashtagDensity: number;
  /** CTA phrases matched, for the "Why?" panel. */
  matchedPhrases: string[];
}

/** CTA hits at which the score saturates. */
const CTA_SCALE = 1.5;

/** Questions per 100 words at which density saturates. */
const QUESTION_SCALE = 3;

/** Hashtags at which density saturates. Three or more reads as reach-farming. */
const HASHTAG_SCALE = 3;

/** Arrows and hands pointing at a call to action. */
const POINTER_EMOJI = /[\u{1F447}\u{1F449}\u{1F448}\u{2B07}\u{1F4AC}\u{1F501}]/gu;

/**
 * Score the closing lines of a post.
 *
 * The ending is where comment-farming concentrates — a post can be substantive
 * throughout and still tack on a bait closer, so the last two lines are scored
 * separately from the body.
 */
function detectClosingHook(lines: string[], lower: string): number {
  const tail = lines.slice(-2);
  if (tail.length === 0) return 0;

  const tailText = tail.join(" ").toLowerCase();
  let score = 0;

  if (/[?]\s*$/.test(tailText)) score += 0.4;

  const { count } = countPhrases(tailText, ENGAGEMENT_CTA);
  if (count > 0) score += 0.5;

  if (countEmoji(tail.join(" ")) > 0) score += 0.1;

  // A trailing hashtag block is reach-farming even without an explicit ask.
  if (/(?:#\w+\s*){3,}$/.test(lower.trimEnd())) score += 0.2;

  return Math.min(score, 1);
}

/** Compute all engagement-bait features for a post. */
export function extractEngagementBait(stats: TextStats): EngagementBaitFeatures {
  const { lower, text, lines, words } = stats;
  const wordCount = Math.max(words.length, 1);

  const cta = countPhrases(lower, ENGAGEMENT_CTA);
  const authority = countPhrases(lower, AUTHORITY_BAIT);

  const questions = (text.match(/\?/g) ?? []).length;
  const hashtags = (text.match(/#[\p{L}\p{N}_]+/gu) ?? []).length;
  const pointers = (text.match(POINTER_EMOJI) ?? []).length;

  return {
    ctaPhrases: saturate(cta.count, CTA_SCALE),
    authorityBait: saturate(authority.count, 1),
    questionDensity: saturate(ratio(questions * 100, wordCount), QUESTION_SCALE),
    closingHook: detectClosingHook(lines, lower),
    pointerEmoji: saturate(pointers, 1),
    hashtagDensity: saturate(hashtags, HASHTAG_SCALE),
    matchedPhrases: [...cta.matched, ...authority.matched],
  };
}
