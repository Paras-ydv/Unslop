# Unslop

A Chrome extension that flags low-value and AI-slop posts in your LinkedIn feed,
in real time and on-device.

Each post gets a verdict — **green** (good read), **yellow** (useful but
generic), or **red** (low value) — plus a "Why?" panel naming the signals behind
it. Everything runs locally. No post ever leaves the browser.

See [plan.md](plan.md) for the full build plan and known problems.

---

## Status

| Phase | Component | State |
| --- | --- | --- |
| 0 | Scaffold and toolchain | ✅ Done |
| 1 | DOM observer and extractor | ✅ Done |
| 2 | Feature engine | ✅ Done |
| 3 | Rule engine and badge UI | ✅ Done |
| 4 | Labeled dataset | ✅ Mechanism done — collecting |
| 5 | Local ML model | ⬜ Blocked on phase 4 data |
| 6 | Backend (optional) | ⬜ Not started |

The extension is usable today. Phases 0–3 are complete, and phase 4's labeling
UI is in place — it now needs 300–500 real labels before phase 5 can begin.

**Accuracy on the built-in corpus: 24/29 exact (83%), zero inversions** — no
green post is ever called red, or the reverse. That corpus is synthetic, so
treat the number as evidence the detectors fire as designed, not as a real-world
accuracy estimate.

---

## Layout

```
extension/
  src/content/      Content script: selectors, extractor, observer, badge
  src/lib/          Pure logic — no DOM, unit-tested
    features/       Four detector groups + the labeled fixture corpus
    scoring/        Rule engine weights and scorer
  src/popup/        Label progress and JSONL export
  public/           manifest.json
shared/             Types shared between extension and backend
backend/            FastAPI service (phase 6, not built yet)
plan.md             Build plan and known problems
```

## Getting started

```bash
cd extension
npm install
npm run build
```

Then load it in Chrome:

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Choose **Load unpacked** and select `extension/dist`

Open LinkedIn and scroll. Each post gets a badge above it.

## Development

```bash
npm run test       # 106 unit tests
npm run typecheck  # types only, no emit
npm run dev        # rebuild content script on change
```

After a rebuild, hit reload on the extension card in `chrome://extensions`, then
refresh LinkedIn.

From the devtools console on a LinkedIn tab:

```js
__unslop.stats()              // posts scored, verdict split, avg ms, cache hits
__unslop.analyze("some text") // score arbitrary text
__unslop.clearCache()         // drop cached verdicts
```

---

## How it works

**Discovery is eager, extraction is lazy.** A `MutationObserver` finds post
elements as LinkedIn injects them; an `IntersectionObserver` defers extraction
until a post nears the viewport. Mutation bursts are debounced, since infinite
scroll fires many records per batch.

**Every LinkedIn-specific assumption lives in one file.**
[selectors.ts](extension/src/content/selectors.ts) layers stable `data-*`
attributes and ARIA roles first, then structural heuristics. A selector that
stops matching skips the post rather than throwing — a redesign degrades the
extension, it does not break the feed.

**Features are pure functions.** Four groups feed a 28-entry vector:

| Group | Measures |
| --- | --- |
| `structural` | emoji bullets, hook pattern, line uniformity, shouting |
| `linguistic` | phrase lexicons, em-dashes, antithesis, tricolon |
| `informational` | numbers, entities, citations, vagueness |
| `engagementBait` | CTA phrases, closing hooks, hashtag stuffing |

**Scoring is interpretable by construction.** A signed weighted sum through a
logistic, then thresholded. Every point of the score traces back to a named
feature, which is what lets the "Why?" panel be honest rather than decorative.

**The badge lives in a Shadow DOM,** so LinkedIn's global CSS cannot reach in
and ours cannot leak out.

### Quality over provenance

The central design rule, from [plan.md](plan.md): this measures **value, not
authorship**. Hand-written engagement bait scores red. An AI-assisted post
carrying real numbers scores green.

That is why informational density carries the heaviest weight of any feature
group, and why the corpus includes posts that are heavily formatted *and*
substantive — they must survive.

## Contributing labels

Open **Why?** on any badge and mark the correct verdict. Labels are stored
locally via `chrome.storage.local` and never transmitted. The toolbar popup
shows progress and class balance, and exports everything as JSONL for phase 5.

Class balance matters more than raw count — 400 labels that are 90% red will
train badly.

## Known gaps

- Truncated posts are marked but not always expanded; the "…see more" click is
  best-effort and the DOM may not have updated when text is read.
- Posts without a URN fall back to a content hash, which collides across genuine
  duplicates. Harmless for scoring, approximate for caching.
- The fixture corpus is synthetic. Real accuracy is unknown until phase 4 data
  arrives.
- Scoring runs on the main thread. It measures well under budget, but phase 5's
  model should move to a Web Worker.
