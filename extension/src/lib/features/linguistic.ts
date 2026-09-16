/**
 * Linguistic detectors: vocabulary choice and sentence rhythm.
 *
 * Phrase lexicons live in `lexicons.ts`. The rhythm detectors here are the
 * subtler half — an author can avoid every banned phrase and still produce
 * text with the uniform cadence and rhetorical tics of templated writing.
 */

import {
  CORPORATE_FILLER,
  HOOK_OPENERS,
  HYPERBOLE,
  LLM_TELLS,
} from "./lexicons";
import {
  clamp01,
  countPhrases,
  mean,
  ratio,
  saturate,
  stdDev,
  type TextStats,
} from "./text-utils";

export interface LinguisticFeatures {
  /** Templated opener phrases, saturated count. 0–1. */
  hookOpeners: number;
  /** Inflated significance claims, saturated count. 0–1. */
  hyperbole: number;
  /** Corporate abstraction phrases, saturated count. 0–1. */
  corporateFiller: number;
  /** LLM-favored connectives, saturated count. 0–1. */
  llmTells: number;
  /** Em-dashes per 100 words, saturated. 0–1. */
  emDashDensity: number;
  /** Strength of "It's not X. It's Y." antithesis patterns. 0–1. */
  antithesis: number;
  /** Tricolon — three parallel short fragments in a row. 0–1. */
  tricolon: number;
  /** Inverted sentence-length variance: 1 means very uniform. 0–1. */
  sentenceUniformity: number;
  /** Phrases matched, for the "Why?" panel. */
  matchedPhrases: string[];
}

/** Lexicon hits at which a category saturates. Two is already a strong tell. */
const PHRASE_SCALE = 1.5;

/** Em-dashes per 100 words at which density saturates. */
const EM_DASH_SCALE = 1.2;

/** Sentence-length std-dev (in words) considered unremarkable. */
const SENTENCE_SPREAD_SCALE = 6;

/** Antithesis: negate-then-assert constructions. */
const ANTITHESIS_PATTERNS: RegExp[] = [
  /\bit'?s not (?:about )?[^.!?\n]{1,40}[.!?]\s*it'?s\b/i,
  /\bnot (?:just|only) [^.!?\n]{1,40}[.!?,]\s*(?:but|it'?s)\b/i,
  /\bstop [^.!?\n]{1,30}[.!?]\s*start\b/i,
  /\bdon'?t [^.!?\n]{1,30}[.!?]\s*(?:do|be|start)\b/i,
  /\bthis isn'?t [^.!?\n]{1,40}[.!?]\s*this is\b/i,
  /\byour? [^.!?\n]{1,30} isn'?t [^.!?\n]{1,30}[.!?]\s*it'?s\b/i,
];

/** Count antithesis constructions, saturating at two. */
function detectAntithesis(text: string): number {
  let hits = 0;
  for (const pattern of ANTITHESIS_PATTERNS) {
    if (pattern.test(text)) hits++;
  }
  return saturate(hits, 1.2);
}

/**
 * Detect tricolon: three or more consecutive short, similarly-sized fragments.
 *
 * "Ship fast. Learn faster. Repeat." — the rhetorical rhythm that makes a post
 * feel authored by cadence rather than by content.
 */
function detectTricolon(sentences: string[]): number {
  if (sentences.length < 3) return 0;

  const wordCounts = sentences.map(
    (s) => (s.match(/[\p{L}\p{N}]+/gu) ?? []).length,
  );

  let bestRun = 0;
  let run = 0;
  for (let i = 0; i < wordCounts.length; i++) {
    const count = wordCounts[i] ?? 0;
    // A single-word fragment ("Repeat." / "Period.") is a strong tricolon beat,
    // so the floor is 1 rather than 2.
    const isShort = count >= 1 && count <= 7;
    const prev = wordCounts[i - 1] ?? 0;
    const isParallel = i > 0 && Math.abs(count - prev) <= 3;

    run = isShort && (run === 0 || isParallel) ? run + 1 : isShort ? 1 : 0;
    bestRun = Math.max(bestRun, run);
  }

  if (bestRun < 3) return 0;
  return clamp01(0.6 + (bestRun - 3) * 0.2);
}

/** Compute all linguistic features for a post. */
export function extractLinguistic(stats: TextStats): LinguisticFeatures {
  const { lower, text, sentences, words } = stats;

  const hook = countPhrases(lower, HOOK_OPENERS);
  const hyp = countPhrases(lower, HYPERBOLE);
  const filler = countPhrases(lower, CORPORATE_FILLER);
  const llm = countPhrases(lower, LLM_TELLS);

  const emDashes = (text.match(/—/g) ?? []).length;

  const sentenceWordCounts = sentences.map(
    (s) => (s.match(/[\p{L}\p{N}]+/gu) ?? []).length,
  );
  const sentenceUniformity =
    sentences.length >= 3
      ? clamp01(1 - saturate(stdDev(sentenceWordCounts), SENTENCE_SPREAD_SCALE))
      : 0;

  return {
    hookOpeners: saturate(hook.count, PHRASE_SCALE),
    hyperbole: saturate(hyp.count, PHRASE_SCALE),
    corporateFiller: saturate(filler.count, PHRASE_SCALE),
    llmTells: saturate(llm.count, PHRASE_SCALE),
    emDashDensity: saturate(
      ratio(emDashes * 100, Math.max(words.length, 1)),
      EM_DASH_SCALE,
    ),
    antithesis: detectAntithesis(text),
    tricolon: detectTricolon(sentences),
    sentenceUniformity,
    matchedPhrases: [
      ...hook.matched,
      ...hyp.matched,
      ...filler.matched,
      ...llm.matched,
    ],
  };
}

/** Mean sentence length in words, exposed for readability checks. */
export function meanSentenceWords(stats: TextStats): number {
  return mean(
    stats.sentences.map((s) => (s.match(/[\p{L}\p{N}]+/gu) ?? []).length),
  );
}
