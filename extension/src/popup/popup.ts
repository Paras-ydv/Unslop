/**
 * Popup: label progress and dataset export.
 *
 * The export is the phase-4 deliverable — it produces the JSONL file that
 * phase 5's training script consumes.
 */

import {
  allLabels,
  clearLabels,
  summarizeLabels,
  toJsonl,
  type Label,
} from "../lib/labels";

/** Phase 5 needs roughly this many labels to train on. */
const TARGET = 400;

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function statRow(label: string, value: string): HTMLElement {
  const row = el("div", "row");
  row.append(el("span", undefined, label), el("span", "value", value));
  return row;
}

function render(labels: Label[]): void {
  const container = document.getElementById("content");
  if (!container) return;
  container.replaceChildren();

  const stats = summarizeLabels(labels);

  if (stats.total === 0) {
    container.append(
      el("p", "empty", "No labels yet. Expand a row in the Unslop panel to mark one."),
    );
    return;
  }

  container.append(statRow("Labeled posts", String(stats.total)));

  // Class balance. A dataset that is 90% one class will not train well, so the
  // split is shown rather than just the total.
  const bars = el("div", "bars");
  for (const verdict of ["green", "yellow", "red"] as const) {
    const bar = el("i", verdict);
    bar.style.width = `${(stats.byLabel[verdict] / stats.total) * 100}%`;
    bar.title = `${verdict}: ${stats.byLabel[verdict]}`;
    bars.append(bar);
  }
  container.append(bars);

  for (const verdict of ["green", "yellow", "red"] as const) {
    container.append(statRow(`  ${verdict}`, String(stats.byLabel[verdict])));
  }

  if (stats.agreement !== null) {
    container.append(
      statRow("Scorer agreement", `${Math.round(stats.agreement * 100)}%`),
      statRow("Corrections", String(stats.disagreements)),
    );
  }

  const progress = el("div", "progress");
  progress.append(
    statRow("Toward 400", `${Math.min(100, Math.round((stats.total / TARGET) * 100))}%`),
  );
  const track = el("div", "track");
  const fill = el("i");
  fill.style.width = `${Math.min(100, (stats.total / TARGET) * 100)}%`;
  track.append(fill);
  progress.append(track);
  container.append(progress);
}

/**
 * Download the labels as JSONL.
 *
 * Uses `chrome.downloads` rather than an anchor click: the popup closes as soon
 * as it loses focus, which can cancel a link-triggered download mid-flight.
 */
async function exportLabels(): Promise<void> {
  const labels = await allLabels();
  if (labels.length === 0) return;

  const blob = new Blob([toJsonl(labels)], { type: "application/x-ndjson" });
  const url = URL.createObjectURL(blob);
  const stamp = new Date().toISOString().slice(0, 10);

  try {
    await chrome.downloads.download({
      url,
      filename: `unslop-labels-${stamp}.jsonl`,
      saveAs: true,
    });
  } finally {
    // Revoke once the download has had a chance to start.
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  }
}

async function refresh(): Promise<void> {
  const labels = await allLabels();
  render(labels);

  const exportButton = document.getElementById("export") as HTMLButtonElement | null;
  const clearButton = document.getElementById("clear") as HTMLButtonElement | null;
  if (exportButton) exportButton.disabled = labels.length === 0;
  if (clearButton) clearButton.disabled = labels.length === 0;
}

document.getElementById("export")?.addEventListener("click", () => {
  void exportLabels();
});

document.getElementById("clear")?.addEventListener("click", () => {
  // Labels are unrecoverable once cleared and represent real manual effort,
  // so this confirms even though it is a single click behind a popup.
  if (!confirm("Delete all saved labels? This cannot be undone.")) return;
  void clearLabels().then(refresh);
});

void refresh();
