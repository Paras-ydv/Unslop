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
| 1 | DOM observer and extractor | ⚠️ Works, unreliable on the live feed |
| 2 | Feature engine | ✅ Done |
| 3 | Rule engine and badge UI | ✅ Done |
| 4 | Labeled dataset | ⚠️ Mechanism done, 0 labels collected |
| 5 | Local ML model | ⬜ Blocked on phase 4 data |
| 6 | Backend (optional) | ⬜ Not started |

The scoring pipeline is complete and the badge renders. The weak link is post
**detection** — finding individual posts in LinkedIn's live DOM has been
unreliable, and everything downstream is blocked on it, including collecting the
labels phase 5 needs. See [Open issues](#open-issues).

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

## Open issues

Roughly in the order they should be tackled.

### 1. Post detection on the live feed is unreliable — blocking

The scorer and badge work; finding posts in LinkedIn's actual DOM does not, yet.
Everything downstream is blocked on this, including collecting labels.

Observed failures, all fixed but none confirmed stable over a long session:

- **Badge attached to the feed container instead of a post.** The structural
  fallback picked "the container with the most text-bearing children", which at
  document level is a page wrapper — so the whole feed scored as one post.
  Discovery now anchors on the author link every post carries, and the extractor
  rejects any body over 6000 characters as a backstop.
- **Discovery froze after the first few posts.** The hydration poll disarmed
  itself on first success, so once `MutationObserver` stopped seeing appended
  nodes — a virtualised list recycling elements — nothing was ever found again.
  The poll now runs for the life of the page.
- **`/feed/foryou/` markup differs from the classic feed.** Class-name selectors
  missed entirely there.

What to do next: run `__unslop.report()` on a real feed after a few minutes of
scrolling and check that `postsFound` keeps climbing and `badged` tracks it. If
a stage fails, `report()` names which one.

### 2. LinkedIn DOM fragility — ongoing

Class names are obfuscated and rotate without notice, so this is maintenance,
not a bug to close. Selectors are layered — stable attributes and ARIA roles
first, then structural heuristics, then content-based discovery — and a miss
skips the post rather than throwing. But each layer is a guess until it is seen
working against the real feed.

The structural fallbacks especially need scrutiny: they are imprecise by design
and will occasionally pick up a sidebar module or an ad.

### 3. Dogfooding has not started — blocks phase 5

**Zero real labels have been collected.** The mechanism is built (correction
buttons in the "Why?" panel, storage, JSONL export) but no data exists, and
phase 5's classifier cannot begin without it.

The target is 300–500 labels. Three things matter while collecting:

- **Class balance.** 400 labels that are 90% red will train badly. The popup
  shows the split; deliberately seek out under-represented classes.
- **Spread over days, not one session.** A single day's feed is a biased sample
  of whatever LinkedIn happened to surface.
- **One person's feed is still one professional network.** Labels will overfit
  to it. Worth sourcing posts from outside the personal feed before trusting any
  accuracy number from phase 5.

### 4. The fixture corpus is synthetic

The 29 fixtures were written to span the pattern space, not sampled from a real
feed. The 83% figure means the detectors fire as designed — it is not a
real-world accuracy estimate, and should not be quoted as one.

### 5. Smaller known gaps

- **Truncated posts.** The "…see more" click is best-effort; the DOM may not
  have updated when text is read, so a post can be scored on its hook line
  alone — the most slop-like part of any post.
- **Unstable post ids.** Posts without a URN fall back to a content hash, which
  collides across genuine duplicates. Harmless for scoring, approximate for
  caching.
- **Main-thread scoring.** Measures well under budget today, but phase 5's model
  should move to a Web Worker before it janks scrolling.
- **Badge styling is unverified.** The CSS was written without seeing it render.
  Dark mode, narrow widths, and LinkedIn's own card styling are all untested.
