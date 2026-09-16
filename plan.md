# Unslop — Build Plan

LinkedIn Content Quality / AI Slop Detector.

A Chrome extension that scores posts in the LinkedIn feed as **green** (good read),
**yellow** (useful but generic), or **red** (low value), in real time, locally.

---

## Status

Phases 0–4 are built. Phase 4's *mechanism* is in place; its milestone is a
data-collection target that only dogfooding can reach.

| Phase | State | Notes |
| --- | --- | --- |
| 0 — Scaffold | Done | TypeScript + Vite, MV3, two build passes |
| 1 — Observer & extractor | Reworked | Retry-on-hydrate, recycle-safe state, author-link-bounded discovery; tested, needs a live session |
| 2 — Feature engine | Done | 28 features across 4 groups, 29-post corpus |
| 3 — Rule engine & panel | Done | 25/29 exact (86%), zero inversions |
| 4 — Labeled dataset | Mechanism done | Correction UI + JSONL export; **0 labels collected so far** |
| 5 — Local ML model | Not started | Blocked on phase 4 data |
| 6 — Backend | Not started | Optional |

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
- List each post in a floating panel, with a "Why?" expandable showing the top
  triggering signals. (Originally an inline badge per post; see problem #13.)
- Cache by post ID (`sessionStorage`) so re-scrolling is free.
- Shadow DOM for the panel so LinkedIn's CSS cannot break it.

**Milestone:** a working, useful, shippable extension. Dogfood it for a week.

---

## Phase 4 — Labeled dataset and calibration  *(part of component 10)*

Add a "this is wrong" control that logs the post and the correction locally.
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

Resolved as *both, badly*: the click is best-effort and usually has not landed
when the text is read, and the resulting `truncated` flag was recorded and then
consumed by nothing. The panel now marks such verdicts provisional. Whether to
keep clicking at all is still open — it mutates the user's feed for a benefit
that mostly does not arrive.

### 5. Dogfooding is a biased sample

One person's feed is not a representative corpus. Phase 4 labels will overfit to
a single professional network. Worth sourcing posts outside the personal feed
before trusting Phase 5 accuracy numbers.

### 6. No ground truth for "low value"

Unlike spam, slop has no objective label. Inter-rater agreement will be poor.
Consider labeling on a finer scale and collapsing to three buckets afterwards.

---

## Problems found while building

Recorded as they came up, because each one is a trap that would recur in a
rewrite.

### 7. Capitalization is not evidence of naming (found in phase 2)

The named-entity proxy counted every capitalized word that was not a known
function word. English capitalizes the first word of every sentence, and slop is
written almost entirely in short imperative sentences — "Ship fast. Learn
faster. Repeat." scored three entity mentions.

The effect was backwards from the intent: informational density, the feature
meant to *defend* good posts, scored **higher on red fixtures than green**.
Fixed by requiring a sentence-initial run to be multi-word or carry an
acronym/digit. Any future NER substitute needs the same guard.

### 8. A scorer with no bias term treats silence as suspicion (found in phase 3)

The first weighting put a post with no firing features at `logistic(0) = 0.5` —
halfway to "low value". Most ordinary posts have few strong signals in either
direction, so the entire yellow class landed above the red threshold and
straightforward prose was flagged as bait.

The fix was a bias term making absence of evidence read as mildly *good*. This
is a prior, not a tuning constant: most posts are not bait, and a false red
costs far more than a false green. Phase 5 must set the model's equivalent
deliberately rather than letting it default to the midpoint.

### 9. Length damping cannot be unconditional (found in phase 3)

Short posts get damped toward neutral because density features are unstable
below ~25 words. But "Agree? 👇 Repost if you agree" is eight words and
completely unambiguous, and damping pushed it out of red. Overt engagement bait
is now exempt from the length rule.

### 10. Verdict explanations must match the verdict

Signals were ordered by magnitude alone, so a red post could lead its "Why?"
panel with a strong *quality* signal. Ordering is now verdict-first, strongest
within each side. Worth preserving when the model supplies signals in phase 5.

### 11. Post detection on the live feed (found by dogfooding)

Every problem above was found by testing. This one was found by *using* the
extension, and it blocked everything downstream until it was rebuilt.

The first round of fixes treated symptoms, and two of the three diagnoses were
wrong. Recorded here in full, because the wrong diagnosis is the instructive
part:

- **A badge attached to the feed container rather than a post.** Diagnosed as
  "the structural fallback picks the container with the most text-bearing
  children", and fixed by anchoring the walk on the author link every post
  carries. That fixed where the walk *started* and left where it *stopped*
  unchanged — it still climbed to the largest ancestor under a 6000-character
  cap, and three ordinary posts are comfortably under it. The real bound is the
  author-link count, read off the first post-sized ancestor: a second actor link
  means a second post. Reading a budget from the markup rather than hard-coding
  one also survives @-mentions, which a fixed cap cannot.
- **Discovery froze after the first few posts.** Diagnosed as the hydration poll
  disarming itself on first success, and fixed by running it for the life of the
  page. The poll was never the problem. The scan it drove skipped any element
  carrying `data-unslop-seen`, that attribute was written onto LinkedIn's own
  nodes, and the feed is virtualised — it reuses a node for a different post.
  The marker survived the swap, so the element was permanently invisible no
  matter how often the poll ran. **A DOM attribute cannot record "we handled
  this" about content the page owns and recycles.** State belongs in a `WeakMap`
  keyed by element *and* post id.
- **Posts silently never scored.** Never diagnosed at all, and the largest of
  the three. The element was unobserved *before* extraction, so a post whose
  body had not hydrated yet was dropped for the life of the page.
  `IntersectionObserver` cannot recover it: it fires on *changes* to
  intersection, and an element that hydrates while already on screen never
  produces another entry. Because `rootMargin` deliberately starts extraction
  200px early, this was the common case, not a race. Elements now stay observed
  and a steady tick re-reads them, gated by a URN comparison so the steady-state
  cost is one attribute read per on-screen post.

Two lessons worth carrying:

**A selector that matches nothing and a selector pointed at the wrong subtree
look identical from outside.** Both produce silence. That ambiguity cost several
debugging rounds, and is why `diagnose()`, `probe()` and `report()` exist — the
last of which names the failing stage in a sentence rather than handing over two
tables to interpret.

**None of this layer had tests.** Every other problem in this file was caught by
one. These three were caught by scrolling, twice each, because the failures only
appear against markup that existed nowhere in the repo. The DOM layer now has
jsdom coverage; that it did not is the actual root cause of how long this took.

### 12. The fixture corpus is synthetic

The 29 fixtures were written to span the pattern space, not sampled from a real
feed. They are adequate for regression testing and useless as an accuracy
estimate — 86% on this corpus says the detectors fire as designed, not that the
extension is 86% accurate in the wild. Only phase 4 dogfood data can say that.

### 13. The inline badge was the wrong attachment point (found in phase 3)

Each post got its own badge, prepended into the post element. That put our UI
inside a container the page owns, recycles and re-renders, and made the "already
badged" marker from problem #11 necessary in the first place — so the UI and the
bug shared a root cause.

Replaced with one panel floating over the feed, owned entirely by us. It cannot
be recycled out from under itself, it needs no marker on LinkedIn's nodes, and
it survives a redesign that would strip an injected child. The cost is that the
verdict no longer sits next to the post, which the panel offsets by scrolling to
a post when its row is opened.

The rule this generalises to: **do not store your state in someone else's
DOM.**
