/**
 * Assembles the four detector groups into one fixed-length feature vector.
 *
 * The vector order is a stable contract: phase 5 trains a classifier against
 * these indices, so entries are only ever appended, never reordered or removed.
 * That contract binds once a model exists. `lexicalDiversity` was removed
 * before one did (problem #16) — the last moment such a change is free.
 *
 * No scoring or thresholding happens here — that is the rule engine's job in
 * phase 3. This module's only opinions are which features exist and how a
 * feature is described to the user when it fires.
 */

import type { ExtractedPost, Signal } from "@shared/types";
import { extractEngagementBait, type EngagementBaitFeatures } from "./engagement-bait";
import { extractInformational, type InformationalFeatures } from "./informational";
import { extractLinguistic, type LinguisticFeatures } from "./linguistic";
import { extractStructural, type StructuralFeatures } from "./structural";
import { analyzeText } from "./text-utils";

export interface FeatureSet {
  structural: StructuralFeatures;
  linguistic: LinguisticFeatures;
  informational: InformationalFeatures;
  engagementBait: EngagementBaitFeatures;
  /** Word count, carried through for length-aware thresholds in phase 3. */
  wordCount: number;
  /** Milliseconds spent computing the feature set. */
  computeMs: number;
}

/**
 * The vector's field order. Appending is safe; reordering breaks any trained
 * model. `direction` records whether a high value means more slop (`"slop"`) or
 * more substance (`"quality"`), which the rule engine uses to pick a sign.
 */
export const FEATURE_KEYS = [
  // Structural
  { key: "bulletLineRatio", group: "structural", direction: "slop", label: "Emoji or arrow bullet list" },
  { key: "emojiDensity", group: "structural", direction: "slop", label: "Heavy emoji use" },
  { key: "oneSentencePerLineRatio", group: "structural", direction: "slop", label: "One sentence per line" },
  { key: "shortLineRatio", group: "structural", direction: "slop", label: "Mostly one-line fragments" },
  { key: "hookPattern", group: "structural", direction: "slop", label: "Cliffhanger opening line" },
  { key: "lineUniformity", group: "structural", direction: "slop", label: "Templated, uniform layout" },
  { key: "shoutingRatio", group: "structural", direction: "slop", label: "ALL CAPS or multiple !!" },

  // Linguistic
  { key: "hookOpeners", group: "linguistic", direction: "slop", label: "Stock opening phrase" },
  { key: "hyperbole", group: "linguistic", direction: "slop", label: "Inflated significance claims" },
  { key: "corporateFiller", group: "linguistic", direction: "slop", label: "Corporate filler phrases" },
  { key: "llmTells", group: "linguistic", direction: "slop", label: "Generic AI-style phrasing" },
  { key: "emDashDensity", group: "linguistic", direction: "slop", label: "Unusual em-dash frequency" },
  { key: "antithesis", group: "linguistic", direction: "slop", label: '"It\'s not X, it\'s Y" framing' },
  { key: "tricolon", group: "linguistic", direction: "slop", label: "Three-beat punchy fragments" },
  { key: "sentenceUniformity", group: "linguistic", direction: "slop", label: "Unusually uniform sentences" },

  // Informational — the counter-signals
  { key: "numberDensity", group: "informational", direction: "quality", label: "Contains concrete numbers" },
  { key: "entityDensity", group: "informational", direction: "quality", label: "Names specific people or companies" },
  { key: "citationDensity", group: "informational", direction: "quality", label: "Links to a source" },
  { key: "vagueness", group: "informational", direction: "slop", label: "Vague quantities instead of figures" },
  { key: "firstPersonRatio", group: "informational", direction: "neutral", label: "First-person account" },
  { key: "prescriptiveness", group: "informational", direction: "slop", label: "Generic prescriptive advice" },

  // Engagement bait
  { key: "ctaPhrases", group: "engagementBait", direction: "slop", label: "Asks for likes or comments" },
  { key: "authorityBait", group: "engagementBait", direction: "slop", label: "Credential-leading opener" },
  { key: "questionDensity", group: "engagementBait", direction: "slop", label: "Many rhetorical questions" },
  { key: "closingHook", group: "engagementBait", direction: "slop", label: "Engagement ask at the end" },
  { key: "pointerEmoji", group: "engagementBait", direction: "slop", label: "Attention-directing emoji" },
  { key: "hashtagDensity", group: "engagementBait", direction: "slop", label: "Hashtag stuffing" },
] as const satisfies readonly FeatureDescriptor[];

export interface FeatureDescriptor {
  key: string;
  group: "structural" | "linguistic" | "informational" | "engagementBait";
  direction: "slop" | "quality" | "neutral";
  label: string;
}

/**
 * How often each feature fires, at or above `SIGNAL_FLOOR`, across the corpus.
 *
 * A feature that fires on nearly every post carries nearly no information, and
 * saying it out loud is worse than saying nothing: the panel spent a row on
 * "Varied vocabulary" — true of every fixture — while the signal that
 * actually separated this post sat below the fold. (That feature is gone; the
 * ranking that demoted it stays, because the next one will not be so obvious.) `informativeness()` turns
 * these rates into a display multiplier so the explanation leads with what was
 * discriminating rather than with whatever ratio happened to be largest.
 *
 * These weight the *explanation* only. The score is unaffected: a common
 * feature can still be the correct reason, and down-ranking it in the score
 * would be double-counting what the weights already encode.
 *
 * Measured, not estimated — regenerate with `npm run rates` after changing a
 * detector or the floor, since both move these numbers. Expect them to move
 * again once real labels replace the synthetic corpus (problem #12): they
 * describe fixtures written to span the pattern space, not a real feed.
 * Anything absent defaults to 0.5.
 */
export const FIXTURE_FIRE_RATES: Readonly<Record<string, number>> = {
  hookPattern: 0.9,
  oneSentencePerLineRatio: 0.81,
  sentenceUniformity: 0.55,
  numberDensity: 0.48,
  lineUniformity: 0.45,
  entityDensity: 0.39,
  tricolon: 0.32,
  ctaPhrases: 0.32,
  questionDensity: 0.32,
  closingHook: 0.32,
  shortLineRatio: 0.29,
  firstPersonRatio: 0.29,
  pointerEmoji: 0.26,
  emDashDensity: 0.23,
  hookOpeners: 0.19,
  bulletLineRatio: 0.13,
  emojiDensity: 0.13,
  citationDensity: 0.13,
  hyperbole: 0.1,
  antithesis: 0.1,
  vagueness: 0.1,
  hashtagDensity: 0.1,
  authorityBait: 0.06,
  shoutingRatio: 0.03,
  corporateFiller: 0.03,
  llmTells: 0.03,
  prescriptiveness: 0.03,
};

/**
 * Minimum feature value worth naming in the "Why?" panel.
 *
 * Raised from 0.3: at that floor a post with nothing notable still filled every
 * row, which reads as evidence and is not. Five weak reasons are less honest
 * than two real ones, and an explanation with nothing in it is a fair thing for
 * the panel to say — the verdict still stands on the full weighted sum either
 * way, since this governs display only.
 */
export const SIGNAL_FLOOR = 0.42;

/**
 * Display multiplier for a feature, from how commonly it fires.
 *
 * Inverse-frequency, the same intuition as IDF: a feature firing on every post
 * tells the reader nothing, one firing on a tenth of them is the reason. The
 * floor keeps a common-but-genuine signal visible rather than suppressed — this
 * reorders the explanation, it does not censor it.
 *
 * A 0% rate reads as "never seen in the corpus", which is not evidence of
 * rarity in the wild — `shoutingRatio` fires on live posts and on no fixture.
 * Those clamp to the same multiplier as a rare-but-seen feature instead of
 * scoring as maximally informative on no evidence.
 */
export function informativeness(key: string): number {
  const rate = FIXTURE_FIRE_RATES[key] ?? 0.5;
  if (rate <= 0) return 1.4;
  return Math.max(0.35, Math.min(1.4, 1 / (0.35 + rate)));
}

/** Fixed-length numeric vector, ordered by `FEATURE_KEYS`. */
export type FeatureVector = number[];

/**
 * Read one declared feature out of a feature set.
 *
 * The groups are interface-typed rather than indexable, so this narrows by
 * group first and then reads the key. Anything non-numeric (the
 * `matchedPhrases` arrays) reads as 0, which keeps the vector well-formed even
 * if a descriptor ever names the wrong field.
 */
function readFeature(features: FeatureSet, descriptor: FeatureDescriptor): number {
  const group: Record<string, unknown> = { ...features[descriptor.group] };
  const value = group[descriptor.key];
  return typeof value === "number" ? value : 0;
}

/** Compute every feature group for a post. */
export function extractFeatures(post: ExtractedPost): FeatureSet {
  const start = performance.now();
  const stats = analyzeText(post.text);

  const features: FeatureSet = {
    structural: extractStructural(stats),
    linguistic: extractLinguistic(stats),
    informational: extractInformational(stats, { linkCount: post.links.length }),
    engagementBait: extractEngagementBait(stats),
    wordCount: stats.words.length,
    computeMs: 0,
  };

  features.computeMs = performance.now() - start;
  return features;
}

/** Flatten a feature set into the fixed-order numeric vector. */
export function toVector(features: FeatureSet): FeatureVector {
  return FEATURE_KEYS.map((descriptor) => readFeature(features, descriptor));
}

/**
 * Turn the strongest-firing features into user-facing signals.
 *
 * Weight here is just the raw feature value — the rule engine replaces it with
 * a properly weighted contribution in phase 3. Ordering is by magnitude so the
 * "Why?" panel can take the top N.
 */
export function toSignals(features: FeatureSet, limit = 5): Signal[] {
  const signals: { signal: Signal; rank: number }[] = [];

  for (const descriptor of FEATURE_KEYS) {
    if (descriptor.direction === "neutral") continue;
    const value = readFeature(features, descriptor);
    if (value < SIGNAL_FLOOR) continue;

    signals.push({
      signal: {
        key: descriptor.key,
        label: descriptor.label,
        weight: descriptor.direction === "quality" ? -value : value,
      },
      rank: value * informativeness(descriptor.key),
    });
  }

  return signals
    .sort((a, b) => b.rank - a.rank)
    .slice(0, limit)
    .map((entry) => entry.signal);
}

/** Every phrase that fired, across both phrase-matching detectors. */
export function matchedPhrases(features: FeatureSet): string[] {
  return [
    ...features.linguistic.matchedPhrases,
    ...features.engagementBait.matchedPhrases,
  ];
}
