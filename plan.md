# Unslop — Build Plan

LinkedIn Content Quality / AI Slop Detector.

A Chrome extension that scores posts in the LinkedIn feed as **green** (good read),
**yellow** (useful but generic), or **red** (low value), in real time, locally.

---

## Ordering principle

The architecture diagram numbers components 1–10, but that is the *data flow*
order, not the *build* order. Build order here is driven by what can be tested
end-to-end earliest, and by getting a shippable product before any ML work.

Phases 0–3 produce a working extension. Everything after that is accuracy
improvement on a product that already works.

---

## Phase 0 — Scaffold

Repo layout and toolchain. Nothing clever.

```
extension/     TypeScript + Vite (CRXJS), manifest v3
backend/       FastAPI + Python — stubbed, not built yet
shared/        types shared between the two
```

- TS config, linting, a build that produces a loadable unpacked extension.

**Milestone:** extension loads in Chrome and logs on `linkedin.com`.

---

## Phase 1 — DOM Observer & Extractor  *(component 1)*

The riskiest part, and everything depends on it. LinkedIn's DOM is obfuscated
and changes often, so this needs a resilient selector strategy plus fallbacks.

- `MutationObserver` on the feed container → detect new post nodes.
- `IntersectionObserver` → only process visible posts (lazy).
- Extract: post text, author, "see more" expansion, links, media presence.
- Normalize: strip whitespace and zero-width characters only.
  Do **not** strip emoji — they are a signal.
- Stable post ID (URN from the DOM) for caching and dedup.

**Milestone:** scroll the feed; clean text is emitted for every post exactly once.

---

## Phase 2 — Feature Engine  *(component 2)*

Pure functions, zero DOM, fully unit-testable. This is where the actual
detection IP lives.

- **Structural:** emoji-bullet lines, `→`/`•` list density, one-sentence-per-line
  ratio, hook-line + whitespace pattern.
- **Linguistic:** banned-phrase lexicon ("game changer", "Here's the thing:",
  "Let that sink in"), em-dash frequency, tricolon and antithesis patterns
  ("It's not X. It's Y."), sentence-length variance (low variance = LLM).
- **Informational:** named entities, concrete numbers, specificity ratio vs.
  abstraction.
- **Engagement bait:** "Agree?", "Thoughts? 👇", "Repost if", comment-farming CTAs.

Output: a fixed-length `FeatureVector` plus per-feature contributions.

**Milestone:** ~50 hand-labeled posts in a fixture file, features computed with
snapshot tests.

---

## Phase 3 — Rule Engine + UI Renderer  *(components 3 and 5)*

Deliberately skips the ML model. A weighted linear score over Phase 2 features
gives green/yellow/red today.

- Thresholds tuned against the fixture corpus.
- Inject a badge into each post, plus a "Why?" expandable showing the top 3
  triggering signals.
- Cache by post ID (`sessionStorage`) so re-scrolling is free.
- Shadow DOM for the badge so LinkedIn's CSS cannot break it.

**Milestone:** a working, useful, shippable extension. Dogfood it for a week.

---

## Phase 4 — Labeled dataset and calibration  *(part of component 10)*

Add a "this is wrong" button that logs the post and the correction locally.
This *is* the training set — without it, Phase 5 has nothing to train on.

**Milestone:** 300–500 labeled posts exported as JSONL.

---

## Phase 5 — Local ML Model  *(component 4)*

Only now. Train a small classifier — start with logistic regression or gradient
boosting over Phase 2 features, which is likely enough. Upgrade to a fine-tuned
MiniLM only if the hand-built features plateau.

Export to ONNX, run via `onnxruntime-web` in the extension. The rule engine
handles confident cases; the model handles the uncertain band.

**Milestone:** measurable accuracy gain over Phase 3 on a held-out set.

---

## Phase 6 — Backend  *(components 6–9, optional)*

Build only when a real need appears: LLM-written explanations on demand,
embedding similarity for detecting recycled or templated posts, or cross-user
aggregation. FastAPI + Postgres + Redis, as diagrammed.

---

## Known problems and open questions

### 1. The 150ms budget is the real constraint

Phase 2 must be pure string operations — no regex backtracking bombs, no
per-post allocation storms. If the main thread janks feed scrolling, move
feature extraction to a Web Worker.

### 2. "AI slop" ≠ "AI-written"

The design principle "content quality > AI authorship" is correct and needs to
be held. Human-written engagement bait should score red; an AI-assisted post
carrying real data should score green.

Consequence: labels are about **value**, not **provenance**, and the feature set
should weight informational density most heavily.

### 3. LinkedIn DOM fragility

Class names are obfuscated and rotate. Selectors must be layered — prefer stable
`data-*` attributes and ARIA roles, fall back to structural heuristics, and fail
soft (skip the post) rather than throwing.

### 4. Truncated post text

LinkedIn collapses long posts behind "…see more". Scoring truncated text biases
results, since the hook line is the most slop-like part of any post. Either
expand programmatically or mark the score as provisional.

### 5. Dogfooding is a biased sample

One person's feed is not a representative corpus. Phase 4 labels will overfit to
a single professional network. Worth sourcing posts outside the personal feed
before trusting Phase 5 accuracy numbers.

### 6. No ground truth for "low value"

Unlike spam, slop has no objective label. Inter-rater agreement will be poor.
Consider labeling on a finer scale and collapsing to three buckets afterwards.
