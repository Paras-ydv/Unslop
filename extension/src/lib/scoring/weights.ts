/**
 * Rule-engine weights and thresholds.
 *
 * These are hand-tuned against the fixture corpus, not learned. Phase 5
 * replaces the linear combination with a trained classifier, but this file
 * stays: the rule engine keeps handling confident cases, and the model only
 * sees the uncertain band.
 *
 * Weights are signed. Positive pushes toward slop, negative toward quality.
 * Magnitudes follow the design principle in plan.md — informational density
 * carries the most weight of any single group, because substance is what
 * separates a well-formatted good post from a well-formatted empty one.
 */

import type { FeatureDescriptor } from "../features/vector";

/** Weight per feature key. Every key in FEATURE_KEYS must appear here. */
export const WEIGHTS: Record<string, number> = {
  // ─── Structural: form only. Weighted lightly on purpose — good posts use
  // bullets and emoji too, so form alone must never be decisive.
  bulletLineRatio: 0.35,
  emojiDensity: 0.30,
  oneSentencePerLineRatio: 0.25,
  shortLineRatio: 0.20,
  hookPattern: 0.55,
  lineUniformity: 0.30,
  shoutingRatio: 0.45,

  // ─── Linguistic: vocabulary and rhythm. Stock phrasing is a stronger tell
  // than layout, since it is harder to produce accidentally.
  hookOpeners: 0.70,
  hyperbole: 0.55,
  corporateFiller: 0.50,
  llmTells: 0.60,
  emDashDensity: 0.20,
  antithesis: 0.60,
  tricolon: 0.50,
  sentenceUniformity: 0.30,

  // ─── Informational: the counter-signals, weighted heaviest in aggregate.
  numberDensity: -0.90,
  entityDensity: -0.75,
  citationDensity: -0.55,
  vagueness: 0.45,
  firstPersonRatio: 0.0, // descriptor only; neither good nor bad
  prescriptiveness: 0.40,
  lexicalDiversity: -0.40,

  // ─── Engagement bait: the clearest slop signal, and independent of
  // authorship. Weighted highest of any individual feature.
  ctaPhrases: 0.95,
  authorityBait: 0.45,
  questionDensity: 0.30,
  closingHook: 0.80,
  pointerEmoji: 0.50,
  hashtagDensity: 0.40,
};

/**
 * Score boundaries. A post at or above `red` is red; at or below `green` is
 * green; anything between is yellow.
 *
 * Tuned against the corpus — see `scorer.test.ts`, which asserts per-fixture
 * verdicts. The band is deliberately asymmetric and wide: yellow is the
 * genuinely ambiguous class, and a post that could plausibly be either should
 * land there rather than being confidently mislabeled in one direction.
 */
export const THRESHOLDS = {
  green: 0.28,
  red: 0.60,
} as const;

/**
 * Confidence band. A post whose score lands within this distance of a
 * threshold is "uncertain" and, from phase 5, gets escalated to the model.
 */
export const UNCERTAIN_MARGIN = 0.08;

/**
 * Posts shorter than this get their score damped toward neutral.
 *
 * A 6-word post has too little evidence for a confident verdict in either
 * direction, and the density features are unstable at that length.
 */
export const MIN_CONFIDENT_WORDS = 25;

/** Look up the weight for a descriptor, defaulting to 0 for unweighted keys. */
export function weightFor(descriptor: FeatureDescriptor): number {
  return WEIGHTS[descriptor.key] ?? 0;
}
