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

/** One human judgment about one post. */
export interface Label {
  /** Post URN, or a content hash for posts without one. */
  postId: string;
  /** Full post text, so the export can train without re-scraping. */
  text: string;
  /** What the user says it should be. */
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
 */
export const SCORER_VERSION = "rules-1";

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
 */
export async function saveLabel(label: Label): Promise<void> {
  if (!hasStorage()) return;
  try {
    const existing = await allLabels();
    const deduped = existing.filter((row) => row.postId !== label.postId);
    deduped.push(label);
    await chrome.storage.local.set({ [STORAGE_KEY]: deduped });
  } catch {
    // Storage failures must not break the feed; the label is simply lost.
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
  disagreements: number;
  /** Share of labeled posts the scorer got right. Null when nothing is labeled. */
  agreement: number | null;
}

/** Summarize the label set, for the popup's progress display. */
export function summarizeLabels(labels: Label[]): LabelStats {
  const byLabel: Record<Verdict, number> = { green: 0, yellow: 0, red: 0 };
  let disagreements = 0;

  for (const row of labels) {
    byLabel[row.label] += 1;
    if (row.label !== row.predicted) disagreements += 1;
  }

  return {
    total: labels.length,
    byLabel,
    disagreements,
    agreement:
      labels.length === 0 ? null : (labels.length - disagreements) / labels.length,
  };
}
