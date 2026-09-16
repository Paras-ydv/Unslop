# Unslop

A Chrome extension that flags low-value and AI-slop posts in your LinkedIn feed,
in real time and on-device.

Each post gets a verdict: **green** (good read), **yellow** (useful but generic),
or **red** (low value). Processing is local by default — no post leaves the
browser unless you ask for a deeper explanation.

See [plan.md](plan.md) for the full build plan, phase ordering, and open problems.

---

## Status

| Phase | Component | State |
| --- | --- | --- |
| 0 | Scaffold and toolchain | ✅ Done |
| 1 | DOM observer and extractor | ✅ Done |
| 2 | Feature engine | ⬜ Not started |
| 3 | Rule engine and badge UI | ⬜ Not started |
| 4 | Labeled dataset | ⬜ Not started |
| 5 | Local ML model | ⬜ Not started |
| 6 | Backend (optional) | ⬜ Not started |

Phase 1 extracts and logs posts. There is no scoring or on-screen UI yet — that
lands in phase 3.

---

## Layout

```
extension/          Chrome extension (TypeScript, Vite, manifest v3)
  src/content/      Content script: selectors, extractor, feed observer
  src/lib/          Pure helpers — no DOM, unit-tested
  public/           manifest.json and static assets
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

Then load the extension in Chrome:

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Choose **Load unpacked** and select `extension/dist`

Open LinkedIn and check the devtools console. Extracted posts are logged at
`debug` level, so enable **Verbose** in the console's level filter to see them.

Run `__unslop.stats()` in the console for post count and average extraction time.

## Development

```bash
npm run dev        # rebuild on change
npm run test       # unit tests
npm run typecheck  # types only, no emit
```

After a `npm run dev` rebuild, hit the reload button on the extension card in
`chrome://extensions` and refresh LinkedIn.

---

## How phase 1 works

**Discovery is eager, extraction is lazy.** A `MutationObserver` on the feed
container finds post elements as LinkedIn injects them; an `IntersectionObserver`
defers the actual extraction until a post nears the viewport. Mutation bursts
are debounced, since infinite scroll fires many records per batch of posts.

**Every LinkedIn-specific assumption lives in one file.**
[selectors.ts](extension/src/content/selectors.ts) layers stable `data-*`
attributes and ARIA roles first, then structural heuristics. When a selector
stops matching, the post is skipped rather than throwing — a LinkedIn redesign
degrades the extension, it does not break the feed.

**Normalization is conservative.**
[normalize.ts](extension/src/lib/normalize.ts) strips only zero-width and bidi
control characters, then collapses horizontal whitespace. Emoji, punctuation,
casing, and line breaks are all preserved, because emoji bullets and
one-sentence-per-line layout are exactly the structural signals phase 2 reads.

**Posts are emitted once.** Elements are marked as seen, and post ids are
deduplicated — LinkedIn re-renders the same post as you scroll, and the feature
engine should not pay for it twice.

## Known gaps

- Truncated posts are marked but not always expanded; the "…see more" click is
  best-effort and the DOM may not have updated by the time text is read.
- Posts without a URN fall back to a content hash, which collides across genuine
  duplicate posts. Harmless for scoring, but it makes per-post caching approximate.
