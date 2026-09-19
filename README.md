# Unslop

A Chrome extension that flags low-value and AI-slop posts in your LinkedIn feed,
in real time and on-device.

Posts are scored as you scroll and listed in a panel that floats over the feed —
**green** (good read), **yellow** (useful but generic), or **red** (low value) —
each with a "Why?" breakdown naming the signals behind it. Everything runs
locally. No post ever leaves the browser.

See [plan.md](plan.md) for the full build plan and known problems.

---

## Status

| Phase | Component | State |
| --- | --- | --- |
| 0 | Scaffold and toolchain | ✅ Done |
| 1 | DOM observer and extractor | ✅ Reworked — needs a long live session to confirm |
| 2 | Feature engine | ✅ Done |
| 3 | Rule engine and panel UI | ✅ Done |
| 4 | Labeled dataset | ⚠️ Mechanism done, 0 labels collected |
| 5 | Fit the weights from labels | ⬜ Blocked on phase 4 data |
| 6 | Backend (optional) | ⬜ Not started |

The scoring pipeline is complete and the panel renders. Post **detection** was
the weak link and has been rebuilt around the two failures that actually caused
it — see [Open issues](#open-issues). It now has test coverage, which it did not
before, but a long real session is still what proves it.

**Accuracy on the built-in corpus: 27/31 exact (87%), zero inversions** — no
green post is ever called red, or the reverse. That corpus is synthetic, so
treat the number as evidence the detectors fire as designed, not as a real-world
accuracy estimate.

---

## Layout

```
extension/
  src/content/      Content script: selectors, extractor, author, dom-text, observer, panel
  src/lib/          Pure logic — no DOM, unit-tested
    features/       Four detector groups + the labeled fixture corpus
    scoring/        Rule engine weights and scorer
  src/popup/        Label progress and JSONL export
  public/           manifest.json
shared/             Types shared between extension and backend
labels/             Collected dataset — gitignored, see labels/README.md
plan.md             Build plan and known problems
```

`backend/` is phase 6 and does not exist yet.

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

Open LinkedIn and scroll. The panel appears in the bottom-right and fills in as
posts come into view.

## Development

```bash
npm run test       # 250 unit tests
npm run typecheck  # types only, no emit
npm run dev        # rebuild content script on change
```

After a rebuild, hit reload on the extension card in `chrome://extensions`, then
refresh LinkedIn.

From the devtools console on a LinkedIn tab:

```js
__unslop.report()             // plain-language health check — start here
__unslop.truncation()         // is a collapsed post's full text in the DOM?
__unslop.authors()            // why a row reads "Unknown author"
__unslop.stats()              // posts scored, verdict split, avg ms, cache hits
__unslop.analyze("some text") // score arbitrary text
__unslop.clearCache()         // drop cached verdicts
```

---

## How it works

**Discovery is eager, extraction is lazy, and neither is one-shot.** A
`MutationObserver` finds post elements as LinkedIn injects them; an
`IntersectionObserver` tracks which are near the viewport; a 500ms tick re-reads
those. The tick is not a workaround — on a virtualised feed an element's
*contents* change without any observer firing, and a post can enter the viewport
before its body exists. Re-reading is the only way to notice either. Steady-state
cost is one attribute read per on-screen post.

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

**The panel floats over the feed rather than writing into it.** It lives in a
Shadow DOM, so LinkedIn's global CSS cannot reach in and ours cannot leak out,
and it touches none of LinkedIn's own nodes — which is what makes it immune to
the feed recycling them underneath it.

### Scrolling

The panel is `position: fixed` and sized to itself, so it occupies no layout
space and intercepts nothing outside its own box: with the cursor anywhere over
LinkedIn, the feed scrolls exactly as it would without the extension. Nothing
binds a `wheel`, `touchmove` or `scroll` listener to the document, nothing calls
`preventDefault`, and `body` is never locked. Scrolling *inside* the panel stops
at its own boundary (`overscroll-behavior: contain`) instead of chaining into
the feed. All four of these are asserted in
[panel.test.ts](extension/src/content/panel.test.ts), because every one of them
is invisible in a screenshot.

Click **✕** to dismiss the panel; it stays dismissed for the rest of the tab and
leaves a small pill to bring it back.

### Quality over provenance

The central design rule, from [plan.md](plan.md): this measures **value, not
authorship**. Hand-written engagement bait scores red. An AI-assisted post
carrying real numbers scores green.

That is why informational density carries the heaviest weight of any feature
group, and why the corpus includes posts that are heavily formatted *and*
substantive — they must survive.

## Collecting labels

Expand any row in the panel and rate the post **1–5** — 1 is a great read, 5 is
slop. Each button names its point on hover (`2 — Good: worth reading, carries
something concrete`), because the scale is only worth its extra cost if 2 means
the same thing in month two as in week one.

Ratings collapse to the three verdicts for scoring, but **1–5 is what gets
stored**: collapsing is one-way, so recording only the coarse form would freeze
both the class boundaries and the thresholds into the dataset. See problem #18
in [plan.md](plan.md).

Labels are written to `chrome.storage.local` immediately and never transmitted.

### Getting the dataset into the repo

A Chrome extension cannot write to arbitrary paths — downloads are the only
channel — so point Chrome's download directory at the repo once:

1. `chrome://settings/downloads`
2. **Location** → Change → `<repo>/labels`
3. Leave **"Ask where to save each file"** off

**Export** in the toolbar popup then writes `labels/unslop/labels.jsonl` in one
click, overwriting the previous file. Full setup and the row format are in
[labels/README.md](labels/README.md).

Export often, not just when you are ready to train. `chrome.storage.local` is
per-profile and per-machine: a cleared profile, a different browser or a new
laptop loses everything that is not in the file. `labels/*.jsonl` is gitignored
— the dataset is other people's posts and does not belong in a public repo.

### What to watch while collecting

- **Class balance beats raw count.** 400 labels that are 90% red train badly.
  The popup shows the split; deliberately seek out the thin classes.
- **The 1–5 spread, also in the popup.** If the counts pile onto 1, 3 and 5,
  the middle points are not being used in practice and the granularity is
  costing effort without buying resolution — worth knowing early, while
  collapsing back is still free.
- **Rate the post, not the scorer.** Agreeing with a verdict you think is wrong
  teaches nothing; the disagreements are where the information is.
- **A failed save says so.** The row shows "NOT SAVED — storage failed" in red
  rather than a tick. Storage errors used to be swallowed, which meant a full
  quota could drop an entire session while the panel kept confirming.

## Open issues

Roughly in the order they should be tackled.

### 1. Post detection needs a long live session — was blocking

Rebuilt around the two mechanisms that were actually breaking it. Both now have
regression tests ([observer.test.ts](extension/src/content/observer.test.ts),
[selectors.test.ts](extension/src/content/selectors.test.ts)); neither had any
before, which is why each shipped twice.

- **A post that scrolled into view before its body loaded was skipped
  permanently.** The element was unobserved *before* extraction, so a body that
  had not arrived yet meant that post was never scored again — and
  `IntersectionObserver` could not recover it, because it fires on changes to
  intersection and an element that hydrates while already on screen never
  produces another entry. `rootMargin` starts extraction 200px early, so this
  was the common case rather than a race. Elements now stay observed and are
  retried by the tick, up to six attempts.
- **Recycled elements went permanently dead.** `data-unslop-seen` and
  `data-unslop-badged` were written onto LinkedIn's own nodes, and its feed is
  virtualised — it reuses a node for a different post. Both markers survived the
  swap, so the scan skipped it, the badge was suppressed, and the new post was
  invisible. This is what the hydration poll was really fighting; making it run
  forever could never have helped, since the scan it drove skipped marked
  elements. State now lives in a `WeakMap` keyed by element *and* post id, and
  the badge markers are gone with the badge.
- **Sibling posts merged into one.** The structural fallback walked up to the
  largest ancestor under a 6000-character cap, which for three ordinary posts is
  the feed container. Anchoring on the author link had fixed where the walk
  started without changing where it stopped. The walk is now bounded by an
  author-link budget read off the first post-sized ancestor, so it stops at the
  post boundary regardless of how short the posts are.

What is still unverified: whether the selectors match at all on markup nobody
has tested them against, `/feed/foryou/` included. Run `__unslop.report()` after
a few minutes of scrolling — `postsFound` should keep climbing and `listed`
should track it.

### 2. Selector validity is now checked, not assumed

An invalid CSS selector throws a `SyntaxError` out of `querySelector`, which
extraction catches and logs — so the whole feed goes silent behind one opaque
`[object DOMException]` console line. That happened once already, from
`[class*='actor']a[href*="/in/"]`: a type selector after an attribute selector,
which is invalid CSS.

**A passing jsdom test does not prove a selector is valid.** jsdom's engine is
more permissive than Chrome's and accepted that selector happily, so the bug
shipped through a green suite.
[selector-validity.test.ts](extension/src/content/selector-validity.test.ts) now
parses every selector the extension uses with lightningcss, which implements the
spec and agrees with the browser. Any selector handed to `querySelector` must be
listed in `DOM_SELECTORS` or `AUTHOR_DOM_SELECTORS`.

A related trap worth naming: interpolating a comma-separated selector list into
a compound selector (`` `[class*='actor'] ${LIST}` ``) only prefixes the first
alternative. The rest silently match anywhere in the document, with no error at
all.

### 3. Comments look exactly like posts

A comment has an author link, a body, and often its own URN, so it satisfies
every structural test for a post. Discovery anchors on author links — which
means it was finding comments and listing them as posts, attributing them to
commenters, and in one case finding *only* the comments and missing the post
they hung off.

Position is the only thing that separates them. The first attempt was a
blocklist — `FOREIGN_REGION` in
[dom-text.ts](extension/src/content/dom-text.ts), a set of class-substring
selectors (`[class*='comment']` and friends) applied at three layers. **It did
not hold on the live feed.** It assumes LinkedIn keeps the word "comment" in a
class name it rotates at will, and it does not: commenters kept arriving in the
panel as posts of their own.

**And the class-based version of the positive form did not hold either.** The
feed LinkedIn ships now has every class hashed (`main._9b4b878a`) and no
`data-urn` or `data-id` on feed items at all — `diagnose()` on the live feed
returned `cardsOnPage: 0` and `urn: null` for every row. There is no name and
no attribute left to match a post container on.

**And ranking by total text did not hold on a permalink page.** The tier that
replaced the class-based form, `findFeedItems`, derives the box from structure
and names nothing: a *feed item* is a child holding one post's worth of text and
at least one profile link, and the feed list is the parent with several of them.
Ranking those candidate lists is the whole problem, and all three obvious metrics
are wrong — each was tried, each failed on the live feed:

- **Most items** picks a comment thread. Five rendered comments beat three
  posts, and every commenter becomes a post.
- **Shallowest** picks a wrapper. Some `<div>` high in `main` has two
  post-shaped children of its own and won on depth alone: `diagnose()`
  reported 2 posts on a feed showing six.
- **Total text** picks the comment thread on a post's own permalink page. It
  measures how much of the page a list accounts for, which is the right question
  on `/feed/` and a meaningless one on `/feed/update/urn:li:activity:.../`,
  where there is one post and its thread. Measured live: **10 items returned,
  all ten of them comments, zero posts.** A post's thread always holds more text
  than the post, so no threshold fixes this. The extension matches
  `https://*.linkedin.com/*`, so it runs on those pages.

  Total text is also only narrowly right at load on `/feed/`. Measured on a cold
  feed, the winner was a layout wrapper holding *the sidebar profile card and the
  entire feed column as one 6 452-character item with 40 author links* —
  `totalChars` 6812 against the real list's 6396, a 6% margin, with `topShare`
  0.947 slipping under the 0.95 cut. It self-corrects once more posts load, which
  is what made it look like a flake rather than a bug.

So the load-bearing test is now `findHeadingCards` in
[selectors.ts](extension/src/content/selectors.ts). LinkedIn opens every genuine
feed card with a **visually-hidden `<h2>`** reading "Feed post". A comment has no
such heading, on any page. That is the positive, containment-shaped test this
file keeps reaching for, and the first one since the class rotation that a
comment cannot satisfy:

| Page | `findFeedItems` | `findHeadingCards` | Truth |
| --- | --- | --- | --- |
| `/feed/` at load | 2 (sidebar + whole feed) | 8 | 8 |
| `/feed/` scrolled | 21 | 23 | ~23 |
| Post permalink | **10, all comments** | 1 | 1 |

Two decisions in it are load-bearing, and both are the lesson from the failures
above rather than new cleverness:

- **It matches the shape, not the string.** Requiring the text "Feed post" is
  the `[class*='comment']` mistake in a new costume — an assumption about a
  string LinkedIn controls, failing silently into the tier that lists
  commenters, and breaking on every non-English feed. The rule is: an `h2` that
  is the *first element child* of its parent, is short, and whose parent has real
  text and an author link.
- **It never touches layout.** The obvious test for "visually hidden" is
  `getBoundingClientRect().height`, which is wrong twice: it flushes layout for
  every heading on every scan, and it is always `0` under jsdom, so a test
  asserting on it passes without proving anything. (It would also have needed a
  tolerance: the heading measures `height: 0` in the feed but `1px` on a
  permalink page.)

There is no upper text cap on a heading-matched card. `MAX_ITEM_TEXT` exists to
stop a *list* being mistaken for an *item*, but the heading has already settled
what the element is — and a permalink card measured 17 751 characters because it
legitimately contains its whole thread. Capping it at 8 000 rejects the only real
post on the page.

`__unslop.shape()` prints every `findFeedItems` candidate with the numbers it was
ranked on (`items`, `totalChars`, `topShare`, `depth`, and the first item's
text), and the content script logs it automatically whenever the derived path is
in use — so a wrong choice says which group it should have been instead.

The named form is kept as the first tier, for when it matches. `POST_CONTAINER` in
[selectors.ts](extension/src/content/selectors.ts) names what a genuine feed
card *is* — `.feed-shared-update-v2`, `.fie-impression-container`,
`[data-finite-scroll-hotkey-item]`, and a post-type URN prefix on `data-urn` /
`data-id` / `data-activity-urn`. Discovery now runs in tiers:

1. **Named post cards.** If any are on the page they are the answer and no
   heuristic is consulted. An element inside a card that is not the card is
   part of a post, not a post — which is what every comment in a thread is,
   whatever its classes say.
2. **The card's accessible heading** (`findHeadingCards`). This is the tier that
   runs on the current feed, and the only one that is correct on a permalink
   page.
3. **The feed list, derived structurally** (`findFeedItems`). Correct on `/feed/`
   once it has loaded; kept for when the heading goes away.
4. **Broad selectors + heuristics**, then walking up from author links. Neither
   can tell a comment from a post; they exist so a redesign degrades instead of
   going blank.

`__unslop.diagnose().path` reports which tier answered — `"cards"`, `"headings"`
and `"structure"` are all containment and all keep comments out; `"heuristics"`
is the degraded path. `headingsOnPage` and `headingCards` alongside it show how
many headings were seen versus accepted: a large gap means the filters are
rejecting real posts, and zero seen on a feed page means LinkedIn dropped the
landmark and tier 2 is no longer load-bearing. The content script logs this to
the page console by itself a few seconds after load, because `__unslop` lives in
the isolated world and is `undefined` at the console's default `top` context.

One thing measured but deliberately left alone: on a permalink page **every
`<article>` element is a comment**, carrying
`urn:li:comment:(ugcPost:<post>,<comment>)`. `POST_SELECTOR` lists a bare
`article`, so tier 4 would hand back ten comments if it ever ran there. It does
not, because the heading tier answers first — but that selector is a loaded gun
pointed at the same bug, and the containment check in `looksLikePost` is all
that stands behind it. (The first-URN-type rule does hold: `URN_TYPE` reads
`comment` from those values, not `ugcPost`.)

Two more things the hashed-class feed broke, both downstream of discovery:

- **`findBodyByContent` took the *longest* text block.** On a post with a busy
  thread that is somebody's comment, and since the author is read as the last
  profile link *before* the body, a comment as the body drags that landmark to
  the bottom of the card and the row gets a commenter's name. It now takes the
  *first* substantial block instead: comments are always below the post.
- **Its 40-character floor was shorter than a LinkedIn byline.** "Founder @
  Rayvanta | Building Outbound Pipelines for B2B Software…" cleared it, so a
  card that had not hydrated yet scored the poster's job title as their post.
  The floor is 80 and blocks carrying a profile link are only used as a last
  resort.

`FOREIGN_REGION` stays, because the body reader still needs it — a post
container legitimately wraps its own comments, and without it a popular post
gets scored as much on its comments as on itself.

Three traps worth naming:

- **A blocklist keyed on obfuscated class names is not a boundary.** It passes
  every jsdom test written against markup with readable class names, and fails
  on the feed. Prefer "must be X" over "must not be Y" wherever the markup
  allows it.

- **A comment URN embeds its parent post's URN.**
  `urn:li:comment:(urn:li:activity:123,456)` contains `urn:li:activity`, so any
  check that looks for "activity" anywhere in the string lets every comment
  vouch for itself as a post. Only the first URN type in the value counts.
- **The author is not the first profile link in the card.** LinkedIn puts a
  social-context line above the actor block ("Ben Shah commented on this"), so
  "first link wins" names someone who did not write the post. The author is the
  last profile link *before the body* — the body being the one landmark that
  does not depend on a class name. Everything after it is a commenter, and when
  nothing precedes it the answer is `null`: "Unknown author" is honest where a
  commenter's name is a lie.

### 4. LinkedIn DOM fragility — ongoing

Class names are obfuscated and rotate without notice, so this is maintenance,
not a bug to close. Selectors are layered — stable attributes and ARIA roles
first, then structural heuristics, then content-based discovery — and a miss
skips the post rather than throwing.

`POST_SELECTOR` has to stay broad to survive that rotation, which means it also
matches ads, job cards and sidebar modules. Those are now filtered by
`looksLikePost` before extraction rather than after, so they no longer inflate
the skip counter that `report()` reasons about — previously a healthy feed
reported dozens of skips and `report()` concluded the body selectors were stale.

### 5. Dogfooding has not started — blocks phase 5

**Zero real labels have been collected.** The mechanism is built (correction
controls in each panel row, storage, JSONL export) but no data exists, and phase
5's classifier cannot begin without it.

The target is 300–500 labels. Three things matter while collecting:

- **Class balance.** 400 labels that are 90% red will train badly. The popup
  shows the split; deliberately seek out under-represented classes.
- **Spread over days, not one session.** A single day's feed is a biased sample
  of whatever LinkedIn happened to surface.
- **One person's feed is still one professional network.** Labels will overfit
  to it. Worth sourcing posts from outside the personal feed before trusting any
  accuracy number from phase 5.

**Settled before collection, not after:** labels record a 1–5 quality rating and
collapse to the three buckets with `toVerdict`. Granularity cannot be recovered
later, so the coarse form would have frozen both the class boundaries and the
thresholds into the dataset — see problem #18 in plan.md. Watch the 1–5 spread
in the popup while collecting: counts piling onto 1, 3 and 5 mean the middle
points are not being used, and the extra granularity is not earning its cost.

### 6. The fixture corpus is synthetic

The 31 fixtures were written to span the pattern space, not sampled from a real
feed. The 86% figure means the detectors fire as designed — it is not a
real-world accuracy estimate, and should not be quoted as one.

### 7. Smaller known gaps

- **Truncated posts — checked on the live feed, reading the whole post.** The
  body is read two ways: rendered (`innerText`) and from the markup, walking
  block boundaries to rebuild line structure without a layout flush. If LinkedIn
  clamps a long post with CSS, the full text is in the markup and only the
  painting is clipped, so the markup read recovers it with no click at all. If
  LinkedIn swaps in a shortened text node, the two reads agree and the click is
  the only option. The extractor prefers whichever source holds more, and only
  clicks when the markup had nothing extra.

  Spot-checked while dogfooding: full post text is reaching the scorer, so
  verdicts are not being computed on hook lines. That was the open question
  here, and it mattered most for phase 4 — a label attached to a hook line is
  wrong training data rather than a scoring bug. `__unslop.truncation()` remains
  for re-checking after a LinkedIn change, and whether `tryExpand` can now be
  deleted outright is still worth settling, since it clicks "see more" on a real
  feed for a benefit that may never arrive.

  Recovering text only ever *appends* to what was already rendered — the
  rendered text must be a prefix of the markup text. "Markup is longer" alone is
  not enough, since it can also mean the walk picked up chrome that `innerText`
  correctly excluded. `truncation()` reports that case separately.

  When nothing can be recovered, the verdict is marked *provisional* in the
  panel rather than the flag being recorded and never used. This matters because
  truncation biases toward red: the hook line is the most slop-like part of any
  post, and the substance that would pull it back toward green is exactly what
  is behind the fold.
- **Unstable post ids.** Posts without a URN fall back to a content hash. Those
  posts are not cached at all, so the collision only affects dedup within a
  session, not verdicts.
- **Author name — rebuilt, previously returned "Unknown author" on the live
  feed.** It was four class-name selectors and no fallback, so a class rotation
  broke every row at once. [author.ts](extension/src/content/author.ts) now
  layers: actor-title classes (including `[class*=...]` forms that survive
  rotation), the actor link's text, its `aria-label`, the avatar's `alt`, the
  profile-URL slug, and finally an actor link on an ancestor — for when the post
  URN sits on an inner wrapper below the actor block. That last layer only
  accepts an ancestor holding exactly one actor link, since two means it has
  reached the feed and the name could belong to a neighbouring post.

  Cleaning does as much work as finding, because none of those sources arrive as
  a bare name: the doubled render ("Ana RuizAna Ruiz"), the trailing headline,
  the connection degree, `aria-label` wrappers ("View Ana Ruiz's profile"). If a
  row still reads "Unknown author", `__unslop.authors()` reports what every
  layer returned and why cleaning rejected it.
- **Main-thread scoring.** The <5ms-per-post figure covers feature extraction on
  in-memory strings only. It does not cover the DOM work. Discovery and the
  markup read are both layout-free, but the rendered read still calls
  `innerText` once per post, and nothing currently measures the total.
- **Panel styling is verified for contrast, not for layout.** Every foreground /
  background pairing clears WCAG AA in both light and dark themes (worst case
  5.08:1), checked numerically. How the panel sits against LinkedIn's own
  chrome at narrow widths is still unverified in a real browser.
