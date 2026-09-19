/**
 * Hand-labeled corpus for tuning and regression-testing the feature engine.
 *
 * Labels are about **value**, not provenance — see problem #2 in plan.md. A
 * post written with AI assistance that carries real numbers is `green`; a
 * hand-typed engagement-farm is `red`.
 *
 * These are synthesized to cover the pattern space, not scraped. Real dogfood
 * data arrives in phase 4; this corpus exists so the detectors have something
 * to be wrong against today.
 */

import type { Verdict } from "@shared/types";

export interface Fixture {
  id: string;
  /** The hand-assigned verdict. */
  label: Verdict;
  /** What this fixture is meant to exercise. */
  note: string;
  text: string;
  /** Outbound links, mirroring what the extractor would find. */
  links?: string[];
}

export const FIXTURES: Fixture[] = [
  // ─── RED: templated slop, engagement bait, empty advice ───
  {
    id: "red-classic-hook-list",
    label: "red",
    note: "Textbook template: hook, emoji bullets, CTA close",
    text: `I got rejected 47 times.

Then everything changed.

Here's what nobody tells you about resilience:

🚀 Failure is just feedback
✅ Every no gets you closer to yes
💡 Your mindset is everything
🔥 Consistency beats talent
⚡ Never give up on your dreams

It's not about how hard you fall. It's about how you rise.

Agree? 👇

#motivation #success #mindset #leadership #growth`,
  },
  {
    id: "red-fake-story",
    label: "red",
    note: "Fabricated-sounding anecdote with moral, no specifics",
    text: `A janitor walked into our boardroom yesterday.

The CEO asked him to leave.

He said one sentence that silenced the entire room:

"I clean this building every night. I've never seen any of you stay past 6."

Let that sink in.

Sometimes the most important lessons come from the most unexpected places.

Thoughts? 💬`,
  },
  {
    id: "red-pure-cta",
    label: "red",
    note: "Almost nothing but the engagement ask",
    text: `Hiring is broken.

Agree?

Comment below if you've felt this.

Repost if you want to help someone in your network.

Follow me for more takes on the future of work. 👇

#hiring #recruitment #jobs`,
  },
  {
    id: "red-llm-generic",
    label: "red",
    note: "LLM-flavored connectives, zero concrete content",
    text: `In today's fast-paced digital landscape, leadership has never been more crucial.

Moreover, as we navigate the ever-evolving world of work, it's worth noting that empathy plays a vital role in team dynamics.

Furthermore, organizations that harness the power of authentic connection will unlock the potential of their people.

In conclusion, leadership is not about titles. It's about impact.`,
  },
  {
    id: "red-tricolon-spam",
    label: "red",
    note: "Three-beat fragments, no information",
    text: `Stop overthinking.

Start shipping.

Ship fast. Learn faster. Repeat.

That's it. That's the post.

Who's with me? 🙌`,
  },
  {
    id: "red-authority-list",
    label: "red",
    note: "Credential-leading with generic advice",
    text: `After 20 years in tech, I've interviewed over 500 engineers.

Here's the truth about what separates the best from the rest:

→ They ask questions
→ They admit what they don't know
→ They care about the user
→ They write clearly
→ They stay curious

Most candidates focus on the wrong things.

Save this post for your next interview. 📌`,
  },
  {
    id: "red-shouting",
    label: "red",
    note: "Typographic shouting and hyperbole",
    text: `THIS IS A GAME CHANGER!!

AI will change EVERYTHING about how we work.

The future of business is here.

And most people are NOT ready.

Read that again.

Tag someone who needs to see this!! 👇`,
  },
  {
    id: "red-vague-metrics",
    label: "red",
    note: "Claims results with only vague quantifiers",
    text: `We significantly improved our conversion rate last quarter.

Many of our customers noticed the difference. Several told us it was the best experience they'd had.

A lot of teams struggle with this. Most never figure it out.

Here's the thing: it wasn't about the tools. It was about the people.

Unpopular opinion: strategy is overrated. Execution is everything.

What do you think?`,
  },
  {
    id: "red-humblebrag",
    label: "red",
    note: "Achievement post dressed as a lesson",
    text: `I was today years old when I realized something important.

Yesterday I closed the biggest deal of my career.

But here's the kicker: it wasn't the money that made me happy.

It was the team that got me there.

Grateful. Humbled. Blessed.

Who's the person that helped you get where you are? Tag them below. 👇 💪`,
  },
  {
    id: "red-listicle-no-substance",
    label: "red",
    note: "Numbered list of platitudes",
    text: `5 habits that changed my life:

1. Wake up early
2. Read every day
3. Exercise consistently
4. Practice gratitude
5. Never stop learning

Simple. Not easy.

Which one will you start today? Comment below. ⚡`,
  },
  {
    id: "red-corporate-filler",
    label: "red",
    note: "Business-speak with no content — the only fixture exercising corporateFiller",
    text: `At the end of the day, it's about moving the needle.

Too many teams boil the ocean instead of picking the low hanging fruit. We need to think outside the box, leverage our core strengths, and take it to the next level.

Moving forward, let's circle back on this and hit the ground running.

Who else has seen this? 👇`,
  },
  {
    id: "red-prescriptive-advice",
    label: "red",
    note: "Second-person imperatives with nothing concrete — the only fixture exercising prescriptiveness",
    text: `Stop waiting for permission.

You need to stop chasing titles and start building skill. Here's how to actually get ahead:

Stop saying yes to everything. Start saying no. You need to protect your time like it's the only thing you own.

Most people never learn this. Don't be most people.`,
  },

  // ─── YELLOW: real content, slop packaging ───
  {
    id: "yellow-real-advice-bad-format",
    label: "yellow",
    note: "Genuinely useful, but templated and CTA-closed",
    text: `Most engineers undersell themselves in salary negotiations.

Here's what actually works:

→ Get the number in writing before you counter
→ Anchor on total comp, not base
→ Name a specific figure, never a range
→ Silence after your counter is not rejection

I've coached 40+ people through this.

Thoughts? 👇`,
  },
  {
    id: "yellow-decent-but-generic",
    label: "yellow",
    note: "Reasonable observation, no specifics or sources",
    text: `Remote work didn't kill company culture.

Bad management did.

Culture was always about whether people trust each other and know what they're working toward. An office never guaranteed that — it just made the absence harder to see.

If your culture collapsed when everyone went home, it wasn't culture. It was proximity.`,
  },
  {
    id: "yellow-personal-no-data",
    label: "yellow",
    note: "Authentic first-person, but no transferable detail",
    text: `I quit my job last month without anything lined up.

It's been more stressful than I expected and I'm not going to pretend otherwise. Some days I feel like I made a huge mistake.

But I've slept better in the last four weeks than I did in the previous two years.

Not advice. Just where I am right now.`,
  },
  {
    id: "yellow-announcement",
    label: "yellow",
    note: "Legitimate news, promotional framing",
    text: `Excited to share that I've joined Figma as a Staff Engineer on the Design Systems team! 🎉

Grateful to everyone at my previous company for three incredible years.

Looking forward to building something people love.

#newrole #figma #excited`,
    links: ["https://figma.com/careers"],
  },
  {
    id: "yellow-curated-link",
    label: "yellow",
    note: "Link share with thin commentary",
    text: `Interesting read on how Postgres handles index-only scans.

Worth 10 minutes if you work with large tables.`,
    links: ["https://www.postgresql.org/docs/current/indexes-index-only-scans.html"],
  },
  {
    id: "yellow-question-post",
    label: "yellow",
    note: "Genuine discussion prompt, not comment-farming",
    text: `Curious what other engineering managers do here.

When a senior engineer and a junior disagree on an approach in code review, and both are defensible — do you let it play out, or step in?

I've been stepping in less lately and I'm not sure it's working.`,
  },

  // ─── GREEN: substance, specificity, sources ───
  {
    id: "green-postmortem",
    label: "green",
    note: "Concrete incident writeup with numbers and mechanism",
    text: `We cut our p99 API latency from 2.4s to 310ms last month. Writing down what actually mattered, because most of it wasn't what we expected.

The biggest win was removing an N+1 query in the permissions check — it was issuing one query per resource in the response, so a 50-item list meant 51 round trips. Batching it saved about 1.6s on the worst endpoints.

Second was connection pool sizing. We were running 20 connections against a Postgres instance that could handle 200, and requests were queueing at the pool, not the database. Raising it to 120 cut another 300ms.

What didn't help: the Redis cache layer we spent three weeks building. Hit rate was 4%. We deleted it.`,
  },
  {
    id: "green-technical-detail",
    label: "green",
    note: "Specific technical content, no formatting tricks",
    text: `A subtle thing about JavaScript's structuredClone that bit us in production:

It throws on functions, DOM nodes, and class instances with private fields — but it silently drops the prototype chain on everything else. So a cloned instance of your class comes back as a plain object with the right data and none of the methods.

We had a validation layer that checked instanceof. It passed in tests because the test fixtures were plain objects, and failed in production against real model instances.

The fix was boring: explicit toJSON and fromJSON on the models rather than relying on a generic clone.`,
  },
  {
    id: "green-data-analysis",
    label: "green",
    note: "Numbers, named source, stated limitation",
    text: `Stack Overflow's 2024 developer survey has a finding that hasn't gotten much attention: 62% of professional developers report using AI tools, but only 43% say they trust the output.

The gap is interesting. It suggests people are using these tools as a starting point rather than an answer, which matches how the engineers on my team actually work — generate, then verify line by line.

Worth noting the sample skews toward people who answer developer surveys, so treat the absolute numbers loosely. The gap between adoption and trust is the part I'd bet is real.`,
    links: ["https://survey.stackoverflow.co/2024/"],
  },
  {
    id: "green-plain-observation",
    label: "green",
    note: "Short, specific, no formatting whatsoever",
    text: `Spent the morning reading our onboarding docs as if I'd never seen them. Found 11 references to a service we shut down in March and two links to a Confluence space that no longer exists.

If you haven't done this at your company recently, it takes about an hour and you will find something.`,
  },
  {
    id: "green-nuanced-disagreement",
    label: "green",
    note: "Argues a position with reasoning, admits tradeoffs",
    text: `I think the pushback against microservices has overcorrected.

The original critique was right: most teams that split a monolith into 40 services did it before they understood their domain boundaries, and ended up with a distributed monolith that was strictly worse.

But the conclusion people drew — "just build a monolith" — misses that the failure was premature decomposition, not decomposition. We split our billing system out after three years of running it inside the main app, and it was unambiguously the right call: different scaling profile, different compliance requirements, different deploy cadence.

The heuristic I'd actually defend is: extract a service when you can name the specific operational property you're buying, and not before.`,
  },
  {
    id: "green-with-numbers-and-emoji",
    label: "green",
    note: "Has emoji and structure but real content — must not trip formatting penalties",
    text: `Quick results from our A/B test on the checkout flow, in case it's useful to anyone:

We removed the account-creation step before payment and saw completion go from 61% to 74% over 3 weeks and about 8,000 sessions. Revenue per visitor went up 11%.

The surprise was that only 9% of guest purchasers later created an account, well below the 30% our growth team predicted. So the "guest checkout hurts retention" argument was real, just much smaller than the conversion gain.

Happy to share the test setup if anyone wants it.`,
  },
  {
    id: "green-correction",
    label: "green",
    note: "Admits error with specifics — rare and high-value",
    text: `Correction to something I posted last week.

I said Rust's borrow checker prevents all data races. That's wrong as stated — it prevents data races in safe Rust, which is a meaningful distinction because unsafe blocks and FFI boundaries can still introduce them.

Two people pointed this out and they were right. The guarantee is real but it's scoped, and I stated it in a way that oversold it.`,
  },
  {
    id: "green-resource-share",
    label: "green",
    note: "Link with substantive framing",
    text: `Dan Luu's post on latency measurement is the thing I send people most often when they say their p50 looks fine.

The core point: p50 tells you about a request nobody has. If a page makes 20 backend calls, the probability that all 20 land at p50 is essentially zero, so the experience most users get is closer to your p95 than your median.

Changed how I read our dashboards.`,
    links: ["https://danluu.com/percentile-latency/"],
  },

  // ─── Edge cases ───
  {
    id: "edge-very-short-green",
    label: "green",
    note: "Too short to score meaningfully — must not default to red",
    text: `Postgres 17 ships incremental backups. Finally.`,
  },
  {
    id: "edge-short-red",
    label: "red",
    note: "Short but unambiguously bait",
    text: `Agree? 👇 Repost if you think so too! #leadership`,
  },
  {
    id: "edge-bullets-with-substance",
    label: "green",
    note: "Bullet list carrying real information — format alone must not condemn it",
    text: `Notes from migrating 1.2TB from MySQL 5.7 to Postgres 15:

- pgloader handled 94% of the schema automatically; the failures were all ENUM columns and one generated column
- Zero-downtime cutover took 6 hours of dual-writes, not the 2 we planned
- Query plans regressed on 3 of our 40 hottest queries; all three needed explicit indexes that MySQL had been getting from its clustered PK
- Total cost was about 60 engineer-hours spread over 5 weeks

Would do it again but I'd budget double the dual-write window.`,
  },
  {
    id: "edge-emoji-heavy-green",
    label: "yellow",
    note: "Heavy emoji, moderate content — tests that emoji alone is not decisive",
    text: `Shipped 🚀

New dashboard is live for all customers as of this morning. Load time is down from 4.1s to 900ms after we moved the aggregation server-side.

Thanks to everyone who tested the beta 🙏`,
  },
  {
    id: "edge-no-punctuation",
    label: "yellow",
    note: "Fragment style without terminal punctuation",
    text: `monday morning
inbox at 400
three fires already
somehow still optimistic

anyone else`,
  },
];

/** Fixtures grouped by label, for assertions that operate per class. */
export function fixturesByLabel(label: Verdict): Fixture[] {
  return FIXTURES.filter((f) => f.label === label);
}
