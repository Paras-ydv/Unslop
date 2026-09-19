/**
 * Label store: records disagreements with the scorer.
 *
 * This is the phase-4 deliverable and the input to phase 5. Every correction
 * captures the post text alongside the verdict the user wanted, so the export
 * is a self-contained training set rather than a list of ids.
 *
 * Storage is `chrome.storage.local`, not `sessionStorage`: labels are the one
 * thing here that must survive the tab closing. Nothing is ever transmitted.
 */

import type { Verdict } from "@shared/types";

/**
 * A human quality judgment, 1 (great read) to 5 (worthless).
 *
 * Finer than the three verdicts the scorer emits, and deliberately so —
 * **collapsing is one-way**. A 1–5 rating always yields a three-way label
 * (`toVerdict`), and a three-way label never yields a rating back. Recording
 * the coarse form would have frozen both the class boundaries and the
 * threshold values into the dataset at collection time, and the only way to
 * change either afterwards is to label every post again.
 *
 * It buys two specific things for phase 5:
 *
 * - **A usable middle.** On a three-way scale "useful but generic" and
 *   "nearly red, being charitable" are the same label, so the boundary the
 *   model most needs to learn is exactly where the data is noisiest. 2 and 4
 *   separate them.
 * - **Movable thresholds.** Buckets can be re-derived at different cut points,
 *   and a regressor can be fit against the rating directly, without
 *   re-labeling.
 *
 * The cost is on the labeler, not the code: telling a 2 from a 3 consistently
 * across months is harder than picking one of three buttons, and inconsistent
 * fine labels are worse than consistent coarse ones. If that turns out to be
 * the binding constraint, collapse with `toVerdict` and nothing is lost —
 * which is the asymmetry that decided this.
 */
export type Rating = 1 | 2 | 3 | 4 | 5;

/** The five points, in order, with the wording the panel shows. */
export const RATING_SCALE: readonly { rating: Rating; label: string; hint: string }[] = [
  { rating: 1, label: "Great", hint: "Learned something I could not have written myself" },
  { rating: 2, label: "Good", hint: "Worth reading, carries something concrete" },
  { rating: 3, label: "Fine", hint: "Neither useful nor objectionable" },
  { rating: 4, label: "Weak", hint: "Mostly filler, thin on substance" },
  { rating: 5, label: "Slop", hint: "No value — bait, platitudes, or pure template" },
];

/**
 * Collapse a rating to the three-way verdict the scorer speaks.
 *
 * The cut points live here alone, so moving them is a one-line change that
 * re-derives every historical label rather than invalidating it. 3 maps to
 * yellow because the middle of the scale *is* the ambiguous class.
 */
export function toVerdict(rating: Rating): Verdict {
  if (rating <= 2) return "green";
  if (rating >= 4) return "red";
  return "yellow";
}

/** One human judgment about one post. */
export interface Label {
  /** Post URN, or a content hash for posts without one. */
  postId: string;
  /** Full post text, so the export can train without re-scraping. */
  text: string;
  /**
   * The judgment, on the 1–5 scale. This is the ground truth; everything
   * coarser is derived from it.
   */
  rating: Rating;
  /**
   * `rating` collapsed to three classes, denormalized into the export.
   *
   * Redundant with `toVerdict(rating)` on purpose: the JSONL is meant to be
   * self-contained for a training script that should not have to reimplement
   * the cut points, and keeping it here means a later change to those points
   * is visible as a mismatch rather than silently altering old rows.
   */
  label: Verdict;
  /** What the scorer said, for measuring where it disagrees. */
  predicted: Verdict;
  /** The scorer's numeric score at the time, for threshold analysis. */
  score: number;
  /** ISO-8601 capture time. */
  at: string;
  /** Scorer version, so labels from different weightings stay distinguishable. */
  scorerVersion: string;
}

/**
 * Bumped whenever weights or thresholds change materially.
 *
 * Labels are judgments about *posts*, so they stay valid across versions — but
 * the `predicted` field is only comparable within one version, and phase 5 needs
 * to know which rows came from which scorer.
 *
 * `rules-2`: `lexicalDiversity` removed and `BIAS` re-fitted (problems #14–#17),
 * and the label scale moved from three verdicts to 1–5. Any `rules-1` row
 * carries no `rating` and cannot be collapsed forward, so phase 5 should read
 * the version before trusting a row's shape.
 */
export const SCORER_VERSION = "rules-2";

const STORAGE_KEY = "unslop:labels";

/** Whether the extension storage API is available in this context. */
function hasStorage(): boolean {
  return typeof chrome !== "undefined" && chrome.storage?.local !== undefined;
}

/** Read every stored label. Returns an empty array when storage is unavailable. */
export async function allLabels(): Promise<Label[]> {
  if (!hasStorage()) return [];
  try {
    const result = await chrome.storage.local.get(STORAGE_KEY);
    const labels = result[STORAGE_KEY];
    return Array.isArray(labels) ? (labels as Label[]) : [];
  } catch {
    return [];
  }
}

/**
 * Record a label, replacing any previous judgment of the same post.
 *
 * Re-labeling is normal — the user may correct themselves — and keeping both
 * rows would put contradictory examples into the training set.
 *
 * Returns whether the write landed, so the UI can say so. It must not throw:
 * a storage failure cannot be allowed to break the feed.
 */
export async function saveLabel(label: Label): Promise<boolean> {
  if (!hasStorage()) return false;
  try {
    const existing = await allLabels();
    const deduped = existing.filter((row) => row.postId !== label.postId);
    deduped.push(label);
    await chrome.storage.local.set({ [STORAGE_KEY]: deduped });
    return true;
  } catch (err) {
    // Reported rather than swallowed. A write can fail for a quota that
    // `unlimitedStorage` did not cover or a profile whose storage is in a bad
    // state, and the old silent catch meant the panel still said "Saved" while
    // every rating in the session was being dropped. Weeks of labeling is
    // exactly the thing that must never fail quietly.
    console.error("[unslop] label not saved:", err);
    return false;
  }
}

/** Remove one post's label. */
export async function removeLabel(postId: string): Promise<void> {
  if (!hasStorage()) return;
  try {
    const remaining = (await allLabels()).filter((row) => row.postId !== postId);
    await chrome.storage.local.set({ [STORAGE_KEY]: remaining });
  } catch {
    // Non-fatal.
  }
}

/** Delete every stored label. */
export async function clearLabels(): Promise<void> {
  if (!hasStorage()) return;
  try {
    await chrome.storage.local.remove(STORAGE_KEY);
  } catch {
    // Non-fatal.
  }
}

/**
 * Serialize labels as JSONL — one JSON object per line.
 *
 * JSONL rather than JSON because it is what the phase-5 training script will
 * stream, and because it appends cleanly if exports are ever concatenated.
 */
export function toJsonl(labels: Label[]): string {
  return labels.map((label) => JSON.stringify(label)).join("\n");
}

/** Counts of labels by class, and how often the scorer disagreed. */
export interface LabelStats {
  total: number;
  byLabel: Record<Verdict, number>;
  /** Counts per point of the 1–5 scale, indexed by rating. */
  byRating: Record<Rating, number>;
  disagreements: number;
  /** Share of labeled posts the scorer got right. Null when nothing is labeled. */
  agreement: number | null;
}

/**
 * Summarize the label set, for the popup's progress display.
 *
 * Both breakdowns are reported because they answer different questions while
 * collecting: `byLabel` is the class balance phase 5 trains against, and
 * `byRating` shows whether the fine scale is actually being used — all the
 * weight landing on 1, 3 and 5 means the middle points are not being
 * distinguished in practice, and the extra granularity is costing effort
 * without buying resolution.
 */
export function summarizeLabels(labels: Label[]): LabelStats {
  const byLabel: Record<Verdict, number> = { green: 0, yellow: 0, red: 0 };
  const byRating: Record<Rating, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  let disagreements = 0;

  for (const row of labels) {
    // Derived rather than read, so a row written before the cut points last
    // moved still counts under the current ones.
    const verdict = toVerdict(row.rating);
    byLabel[verdict] += 1;
    byRating[row.rating] += 1;
    if (verdict !== row.predicted) disagreements += 1;
  }

  return {
    total: labels.length,
    byLabel,
    byRating,
    disagreements,
    agreement:
      labels.length === 0 ? null : (labels.length - disagreements) / labels.length,
  };
}
