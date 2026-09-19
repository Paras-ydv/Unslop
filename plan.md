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
| 2 — Feature engine | Done | 27 features across 4 groups, 31-post corpus |
| 3 — Rule engine & panel | Done | 27/31 exact (87%), zero inversions |
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

### 2b. What "slop" means, per the literature

Added after checking the design against [Wikipedia's AI slop
article](https://en.wikipedia.org/wiki/AI_slop) and the Kommers et al. study it
cites, which gives three prototypical properties:

| Property | Meaning | Covered here |
| --- | --- | --- |
| Superficial competence | reads as competent, carries no depth | Yes — the informational group, weighted heaviest |
| Asymmetric effort | little human investment per unit of output | Partly — the structural/template features proxy it |
| Mass producibility | cheap to generate at volume | **No — not measured at all** |

Two things worth taking from it.

The definition is **"lacking in effort, quality, or meaning… produced in high
volume"**, pejorative "similar to spam" — about the content, not its
provenance. That is problem #2 above, arrived at independently, and it is why
`numberDensity` and `entityDensity` carry the heaviest counter-weights.

The gap is mass producibility, and it is real. A single post cannot reveal that
it is one of a thousand near-identical outputs; only comparison across a feed
can. That is cross-post state, not per-post scoring, so it belongs with the
embedding-similarity work already sketched in phase 6 rather than in the feature
engine.

What the article does **not** give is new detectors for this product. Its
concrete tells are visual (six fingers, malformed logos) or provenance-based
(fake author bios, absent performance history); the textual ones — fabricated
citations, prompts left in the output — are real but rare on LinkedIn and mostly
need external verification. It is corroboration for the design, not a source of
features.

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

**Settled — see problem #18.** Labels record 1–5 and collapse with `toVerdict`.

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

The 31 fixtures were written to span the pattern space, not sampled from a real
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

### 14. The explanation surfaced the least informative signals (found by dogfooding)

The panel's "WHAT THIS IS BASED ON" list read like a horoscope — "ALL CAPS or
multiple !!", "Three-beat punchy fragments", "Unusually uniform sentences",
"Varied vocabulary" — four observations true of almost any post, on a verdict
that was itself defensible. The score was not the problem; the *explanation*
was, and from outside they are indistinguishable.

Both `toSignals` and the scorer ranked by magnitude alone. The features with the
largest values are reliably the cheap structural ratios, because they are
continuous and fire on ordinary formatting, while the features carrying the
design intent — `ctaPhrases` at 0.95, `numberDensity` at −0.90 — fire rarely and
specifically. So the panel systematically led with the generic and buried the
discriminating, exactly inverting `weights.ts`'s stated rule that form alone
must never be decisive. That rule was honoured in the score and nowhere else.

Measured across the corpus, the fire rate above the old 0.3 floor:

| Feature | Fires on |
| --- | --- |
| `lexicalDiversity` | **100%** |
| `oneSentencePerLineRatio`, `hookPattern` | 90% |
| `sentenceUniformity` | 72% |
| `ctaPhrases` | 34% |
| `shoutingRatio`, `corporateFiller`, `citationDensity`, `prescriptiveness` | **0%** |

`lexicalDiversity` fires on every fixture, which makes it worthless as an
explanation whatever its weight: a reason given for every post distinguishes
none of them. Ranking is now `|contribution| × informativeness(key)`, an
inverse-frequency multiplier from those rates, and the display floor rose from
0.3 to 0.42.

Three things this deliberately does not do:

- **It does not touch the score.** Verdicts were byte-identical across the
  change — 25/29, zero inversions, measured before problem #15 grew the
  corpus. Down-ranking a common feature in the *score* would double-count what
  the weights already encode.
- **It does not censor.** The multiplier is clamped to [0.35, 1.4], so a common
  signal that is genuinely the reason still appears, lower down.
- **It does not read a 0% rate as "rare".** `shoutingRatio` fires on no fixture
  and fires on live posts, so a zero rate means *unmeasured*, not informative,
  and clamps to the same multiplier as a rare-but-seen feature rather than
  scoring as maximally distinguishing on no evidence.

Two lessons.

**A rate of 0% and a rate of 100% are both "this feature explains nothing", for
opposite reasons.** One never fires and the other always does. Four of the 28
features have never fired on the corpus at all, which means they are unweighted
guesses no test exercises — and `shoutingRatio` appearing on a live post proves
the corpus, not the feature, is what is missing.

**The base rates are measured against 29 synthetic fixtures, so they inherit
problem #12 entirely.** They say how often a feature fires on fixtures written
to span the pattern space, which is not how often it fires on a real feed.
Regenerate them from real labels once phase 4 has data; until then they are the
best available estimate and explicitly not ground truth.

### 15. Four features had never fired on anything (found while fixing #14)

Measuring fire rates for #14 turned up four features that fired on *no* fixture:
`shoutingRatio`, `corporateFiller`, `prescriptiveness`, and `citationDensity`
below the display floor. Each carried a weight in the scorer, so each was
contributing to verdicts with nothing exercising it and no test that would
notice it breaking.

Probing them individually separated two different causes, which is why the
fix is not one change:

- **`corporateFiller` and `prescriptiveness` work.** Given business-speak or
  second-person imperatives they saturate immediately. Nothing in a corpus
  written to span *formatting* patterns happened to contain either. Fixed by
  adding `red-corporate-filler` and `red-prescriptive-advice`.
- **`shoutingRatio` was broken.** It required every letter on a line to be
  capitalised, and real typographic shouting is one word inside an ordinary
  sentence — "AI will change EVERYTHING about how we work." The corpus's own
  `red-shouting` fixture scored **0.17**: a detector did not fire on the
  fixture written to exercise it, and the suite passed anyway. Two further
  misses came out of the same trace: "NOT" is three letters, and `[!?]{2,}$`
  could not match a line closing with the pointer emoji that slop reliably
  appends.

The shouting rule now also matches a capitalised run inside a line, at five
letters or more plus a small allowlist of emphasis words that are never
acronyms (`NOT`, `NEVER`, `MUST`, …). The length floor is the whole difficulty:
an acronym is also a capitalised run, and **a false positive here lands on
exactly the acronym-dense technical posts the informational weights exist to
defend**. Five clears API, SQL, CEO, HTTP and JSON at the cost of missing a
shouted five-letter word, which is the cheaper error. The allowlist is English
and does not generalise; a non-English feed gets the length rule only.

`red-shouting` now scores 0.67, and an acronym-heavy technical paragraph still
scores 0. Corpus: 31 fixtures, 27 exact (87%), zero inversions.

`corpus.test.ts` now asserts that **every weighted feature fires on at least one
fixture**. A feature nothing exercises is a guess wearing a coefficient, and the
rule this generalises to is the one that keeps recurring in this file: a number
nothing tests is not evidence, whatever its precision.

Worth stating plainly, because #14 and #15 came from the same measurement: **a
0% fire rate and a 100% fire rate are the same finding.** Neither feature can
explain anything — one never fires, the other never distinguishes — and both
looked fine until the rates were counted. Nothing here was caught by the 250
tests that were already passing.

### 16. A feature that fires on everything is a bias term in disguise

`lexicalDiversity` — unique words over total — fired above the display floor on
**100% of fixtures**, the finding that came out of #14's rate table. Measured
per class, it explains why:

| Class | Mean |
| --- | --- |
| red | 0.795 |
| yellow | 0.787 |
| green | 0.784 |

Three numbers inside 0.011 of each other, on the feature's *own* axis, and
ordered slightly backwards from its `quality` direction. It separated nothing.
At a −0.40 weight it subtracted ~0.32 from every post's sum regardless of
content, which is the definition of a bias term, not a signal.

Deleting it alone dropped the corpus from 87% to **77%** — and that drop is the
proof rather than a setback. Every class shifted upward together: three yellows
crossed into red, three greens into yellow, no class hurt differentially. **A
feature carrying real information does not translate the whole distribution
when removed; a constant does.** `BIAS` absorbed it, 0.75 → 1.05, and the
corpus returned to 27/31 with the same four misses as before.

Two things to carry.

**The bias must be set deliberately, which problem #8 already said.** It was
right that absence of evidence should read as mildly good; what it missed is
that a second, accidental bias had grown inside the feature set where nothing
would look for it. Phase 5 inherits this trap directly — a model fed a constant
feature will happily learn a coefficient for it and bury the same offset in a
place that is harder to inspect than a named constant.

**The sweep is not a tuning result.** Across bias 0.95–1.25 the corpus scores
25–27 with no clean peak; 1.05 is the least-surprising value in a flat region,
worth one fixture on 31 synthetic posts. Quoting it as tuned would be the
83%-on-a-synthetic-corpus mistake from problem #12 in a new place.

The vector is now 27 features. Removing an entry from `FEATURE_KEYS` breaks the
index contract in its header — which was free here only because no model exists
yet. After phase 5 trains, this same change costs a retrain.

### 17. The uniformity pair is correlated and both are load-bearing (not changed)

`lineUniformity` and `sentenceUniformity` correlate at **r = 0.64**, and both
carry 0.30, so uniformity contributes 0.60 in combination. That looked like
double-counting and was queued as a fix. Measuring it first says otherwise, so
nothing was changed — recorded here because the *non*-change is the finding.

Both separate the classes on their own:

| Class | line | sentence | sum |
| --- | --- | --- | --- |
| red | 0.501 | 0.583 | 1.085 |
| yellow | 0.356 | 0.427 | 0.783 |
| green | 0.166 | 0.293 | 0.459 |

Monotonic in both, red−green separation 0.336 and 0.290. That is not the
signature of one feature counted twice; that is two correlated features that
each work. Compare `lexicalDiversity` in problem #16, whose class means sat
inside 0.011 of each other — *that* is what a redundant feature looks like, and
the contrast is the reason for measuring rather than reasoning from the
correlation alone.

The three fixtures where they disagree by more than 0.35 say what each one
actually measures:

- `green-data-analysis` — line 0.69, sentence 0.18. Even paragraph blocks,
  varied sentences inside them. Genuine prose that happens to be evenly
  chunked.
- `green-plain-observation` — line 0.00, sentence 0.57. Ragged line lengths,
  similar sentence lengths.
- `edge-short-red` — line 0.00, sentence 0.68.

Line uniformity is a property of *layout*; sentence uniformity is a property of
*rhythm*. A templated post is usually both, which is the 0.64 — but a post can
be either alone, and collapsing them would lose exactly those cases.

A sweep over both weights, jointly with `BIAS` across 0.85–1.15, confirms it:
the current 0.30/0.30 at bias 1.05 scores 27/31 and **every reduction tested
scored worse** — 0.22/0.22 → 26, 0.18/0.18 → 24, dropping either to zero → 25.

Worth stating plainly, since two of the three items queued after problem #14
turned out differently once measured: **high correlation between two features is
a reason to check for redundancy, not evidence of it.** The check is whether
each separates the classes, and here both do.

### 18. Label granularity, settled before collection rather than after

Labels recorded the same three verdicts the scorer emits, which was never a
decision — it was the shape the code happened to have. Problem #6 above had
flagged the alternative and left it open. It is now 1–5, collapsing to the three
buckets through `toVerdict` in [labels.ts](extension/src/lib/labels.ts).

The asymmetry is the whole argument, and it is not about which scale is better:

- Finer, and it turns out unnecessary → collapse, lose nothing.
- Coarse, and it turns out insufficient → **re-label every post.**

So the cost of being wrong is an hour in one direction and the entire dataset in
the other. That settles it without needing to predict which is right.

Two things it buys phase 5 concretely. **A usable middle**: on a three-way scale
"useful but generic" and "nearly red, being charitable" are the same label, so
the boundary the model most needs to learn is exactly where the data is
noisiest. **Movable thresholds**: buckets can be re-derived at different cut
points, and a regressor can be fit against the rating directly, neither of which
is possible once the coarse form is all that was recorded.

The cost is real and lands on the labeler, not the code: telling a 2 from a 3
consistently across months is harder than picking one of three buttons, and
inconsistent fine labels are worse than consistent coarse ones. Two mitigations
are in place. Each button carries a word and a hint (`2 — Good: worth reading,
carries something concrete`) so the points stay anchored to the same meaning
over time. And the popup plots the 1–5 spread beside the three-way split: **if
the counts pile onto 1, 3 and 5, the middle points are not being distinguished
in practice** and the granularity is costing effort without buying resolution —
visible early, while collapsing back is still free.

`rating` is the stored truth and `label` is denormalized beside it. The
redundancy is deliberate: the JSONL has to be self-contained for a training
script that should not reimplement the cut points, and `summarizeLabels`
derives the class from `rating` rather than reading `label`, so moving a
boundary re-counts historical rows instead of invalidating them.

`SCORER_VERSION` is now `rules-2`, covering both this change and the weight
changes in #14–#17. A `rules-1` row carries no `rating` and cannot be collapsed
forward, so phase 5 must read the version before trusting a row's shape.
