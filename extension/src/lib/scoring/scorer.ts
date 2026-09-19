/**
 * The rule engine: turns a feature set into a verdict.
 *
 * A weighted linear combination, normalized to 0–1, then thresholded. This is
 * deliberately simple and fully interpretable — every point of the score traces
 * back to a named feature, which is what makes the "Why?" panel honest.
 */

import type { Classification, ExtractedPost, Signal, Verdict } from "@shared/types";
import {
  extractFeatures,
  FEATURE_KEYS,
  informativeness,
  type FeatureSet,
} from "../features/vector";
import {
  MIN_CONFIDENT_WORDS,
  THRESHOLDS,
  UNCERTAIN_MARGIN,
  weightFor,
} from "./weights";

/** A scored post, with the intermediate detail the UI needs. */
export interface ScoredPost extends Classification {
  /**
   * Present only when the post was actually scored. A verdict restored from
   * cache has none: the features are large, rebuildable, and read by nothing
   * downstream, so recomputing them for a cache hit is pure cost.
   */
  features?: FeatureSet;
  /** True when the score sits close enough to a threshold to warrant the model. */
  uncertain: boolean;
}

/**
 * Map a signed weighted sum to 0–1 via a logistic curve.
 *
 * `BIAS` is subtracted from the sum before the curve, which sets where a post
 * with no firing features lands. Without it the neutral point is logistic(0) =
 * 0.5, i.e. plain unremarkable prose starts out halfway to "low value" — and
 * since most ordinary posts have few strong signals in either direction, that
 * put the whole yellow class above the red threshold.
 *
 * A positive bias means absence of evidence reads as mildly good rather than
 * mildly suspicious, which is the correct prior: most posts are not bait, and
 * the cost of a false red is much higher than a false green.
 *
 * Raised from 0.75 when `lexicalDiversity` was removed (problem #16). That
 * feature scored 0.79 on average with a −0.40 weight, so it was subtracting
 * ~0.32 from every post's sum regardless of content — a bias term wearing a
 * feature's name. Deleting it without moving `BIAS` shifted the whole
 * distribution up and cost 10 points of corpus accuracy, which is the
 * measurement that proves what it had been doing: a real feature's removal
 * would have hurt one class, not translated all three.
 *
 * 1.05 rather than the arithmetic 1.07, because a sweep recovered the full
 * 27/31 there. Read that honestly: across 0.95–1.25 the corpus scores 25–27
 * with no clean peak, so this is one fixture's worth of noise on 31 synthetic
 * posts, not a tuned optimum. It is the least-surprising value in a flat
 * region, and phase 5 should fit the model's equivalent from real labels
 * rather than inherit this number.
 */
const STEEPNESS = 1.6;
const BIAS = 1.05;

function logistic(sum: number): number {
  return 1 / (1 + Math.exp(-STEEPNESS * (sum - BIAS)));
}

/** Compute the weighted sum and the per-feature contributions behind it. */
function accumulate(features: FeatureSet): {
  sum: number;
  contributions: Signal[];
} {
  let sum = 0;
  const contributions: Signal[] = [];

  for (const descriptor of FEATURE_KEYS) {
    const weight = weightFor(descriptor);
    if (weight === 0) continue;

    const group: Record<string, unknown> = { ...features[descriptor.group] };
    const raw = group[descriptor.key];
    if (typeof raw !== "number" || raw === 0) continue;

    const contribution = raw * weight;
    sum += contribution;
    contributions.push({
      key: descriptor.key,
      label: descriptor.label,
      weight: contribution,
    });
  }

  return { sum, contributions };
}

/** Pick the verdict for a score. */
function verdictFor(score: number): Verdict {
  if (score >= THRESHOLDS.red) return "red";
  if (score <= THRESHOLDS.green) return "green";
  return "yellow";
}

/**
 * Distance from the nearest threshold, mapped to 0–1.
 *
 * A post scoring far from both boundaries is confidently classified; one
 * sitting on a boundary is not, and is what phase 5's model will adjudicate.
 */
function confidenceFor(score: number): number {
  const distance = Math.min(
    Math.abs(score - THRESHOLDS.green),
    Math.abs(score - THRESHOLDS.red),
  );
  // A quarter of the score range away from any boundary is full confidence.
  return Math.min(1, distance / 0.25);
}

/**
 * Score a post.
 *
 * Short posts are damped toward the neutral midpoint: the density features are
 * unstable below roughly 25 words, and a confident red on a one-line post is
 * more often a bug than a judgment.
 */
export function scorePost(
  post: ExtractedPost,
  precomputed?: FeatureSet,
): ScoredPost {
  const features = precomputed ?? extractFeatures(post);
  const { sum, contributions } = accumulate(features);

  let score = logistic(sum);

  // Explicit bait needs no length to be unambiguous — "Agree? 👇 Repost if you
  // agree" is 8 words and certain. Damping it toward neutral would be a bug,
  // so posts with a strong direct ask are exempt from the short-post rule.
  const overtBait =
    features.engagementBait.ctaPhrases > 0.5 &&
    features.engagementBait.closingHook > 0.5;

  if (features.wordCount < MIN_CONFIDENT_WORDS && !overtBait) {
    // Pull toward the no-evidence baseline, not toward 0.5 — with the bias
    // applied, a featureless post sits below the midpoint, and damping toward
    // 0.5 would push short posts *up* into yellow rather than leaving them
    // unremarkable.
    const baseline = logistic(0);
    const damping = features.wordCount / MIN_CONFIDENT_WORDS;
    score = baseline + (score - baseline) * damping;
  }

  const verdict = verdictFor(score);
  const confidence = confidenceFor(score);

  // Signals are ordered so the ones *explaining the verdict* come first: a red
  // post leads with what made it red, even if some quality signal happens to
  // have a larger magnitude.
  //
  // Within a side, ordering by contribution alone surfaces whichever feature is
  // largest, and the largest are reliably the cheap structural ratios that fire
  // on most posts — so the panel led with "uniform sentences" while the
  // engagement ask that actually decided the verdict sat below the fold.
  // Scaling by `informativeness` puts the discriminating signal first. It
  // reorders the explanation only; `sum` above is untouched.
  const leading = verdict === "green" ? -1 : 1;
  const rank = (s: Signal): number =>
    Math.abs(s.weight) * informativeness(s.key);
  const signals = contributions
    .sort((a, b) => {
      const aLeads = Math.sign(a.weight) === leading;
      const bLeads = Math.sign(b.weight) === leading;
      if (aLeads !== bLeads) return aLeads ? -1 : 1;
      return rank(b) - rank(a);
    })
    .slice(0, 6);

  return {
    postId: post.id,
    verdict,
    score,
    confidence,
    signals,
    source: "rules",
    features,
    uncertain:
      Math.abs(score - THRESHOLDS.green) < UNCERTAIN_MARGIN ||
      Math.abs(score - THRESHOLDS.red) < UNCERTAIN_MARGIN,
  };
}

/** Short user-facing summary for a verdict. */
export function verdictLabel(verdict: Verdict): string {
  switch (verdict) {
    case "green":
      return "Good read";
    case "yellow":
      return "Useful, but generic";
    case "red":
      return "Low value";
  }
}

/**
 * One-line reason, drawn from the strongest signal.
 *
 * The panel shows this on the collapsed row, before the user opens it, so it
 * names the single dominant factor rather than summarizing all of them.
 */
export function summarize(scored: ScoredPost): string {
  const top = scored.signals[0];
  if (!top) return "No strong signals";

  if (scored.verdict === "green") {
    const positive = scored.signals.find((s) => s.weight < 0);
    return positive ? positive.label : "Specific and concrete";
  }
  return top.weight > 0 ? top.label : "Mixed signals";
}
