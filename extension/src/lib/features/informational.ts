/**
 * Informational detectors: how much the post actually tells you.
 *
 * These are the *counter*-signals. Everything else in the feature engine
 * measures slop-like form; this measures substance, and it is what separates a
 * well-formatted post with real data from a well-formatted post with none.
 *
 * Per the design principle in plan.md — quality over provenance — these
 * features carry the most weight in the rule engine. An AI-assisted post
 * carrying concrete numbers and named entities should score green.
 */

import { VAGUE_QUANTIFIERS } from "./lexicons";
import {
  countPhrases,
  ratio,
  saturate,
  type TextStats,
} from "./text-utils";

export interface InformationalFeatures {
  /** Concrete numbers per 100 words, saturated. 0–1. Higher is better. */
  numberDensity: number;
  /** Capitalized mid-sentence tokens per 100 words, saturated. 0–1. Higher is better. */
  entityDensity: number;
  /** Outbound citations, saturated. 0–1. Higher is better. */
  citationDensity: number;
  /** Vague quantifier phrases, saturated. 0–1. Higher is worse. */
  vagueness: number;
  /** First-person-singular share of pronouns. 0–1. Anecdote marker, neutral. */
  firstPersonRatio: number;
  /** Second-person-imperative advice framing. 0–1. Higher is worse. */
  prescriptiveness: number;
  /** Lexical diversity — unique words over total. 0–1. Higher is better. */
  lexicalDiversity: number;
}

/** Numbers per 100 words at which density saturates. */
const NUMBER_SCALE = 2.5;

/** Entity mentions per 100 words at which density saturates. */
const ENTITY_SCALE = 4;

/** Vague quantifier hits at which vagueness saturates. */
const VAGUE_SCALE = 2;

/**
 * Concrete quantities: bare numerals, percentages, currency, multipliers.
 * Excludes list numbering ("1.", "2.") at the start of a line, which is
 * formatting rather than information.
 */
const NUMBER_MATCH =
  /(?:^|[^\d.])\$?\d[\d,]*(?:\.\d+)?\s*(?:%|k|m|b|bn|x|hrs?|hours?|mins?|days?|weeks?|months?|years?|million|billion)?/gim;

/**
 * Proper-noun-ish runs: capitalized words, optionally with an internal
 * lowercase particle ("Bank of America"), plus all-caps acronyms and
 * alphanumeric product names ("Postgres 15", "GPT-4", "S3").
 */
const CAPITALIZED_RUN =
  /\b(?:[A-Z][a-z]{1,}|[A-Z]{2,})(?:[-\d.]+\w*)?(?:\s+(?:of|the|and|for)\s+)?(?:\s*(?:[A-Z][a-z]{1,}|[A-Z]{2,})(?:[-\d.]+\w*)?)*/g;

/**
 * Count numeric facts, skipping list markers.
 *
 * A post reading "3 lessons:" followed by "1. ... 2. ... 3. ..." carries one
 * number of information, not four.
 */
function countNumbers(text: string): number {
  let count = 0;
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    // Strip a leading list marker before counting.
    const body = trimmed.replace(/^\s*\d{1,2}[.)]\s+/, "");
    count += (body.match(NUMBER_MATCH) ?? []).length;
  }
  return count;
}

/**
 * Approximate named-entity density.
 *
 * A real NER model is out of budget, so this counts capitalized runs as a
 * proxy. The hard part is that English capitalizes the first word of every
 * sentence, and slop is written almost entirely in short imperative sentences
 * ("Ship fast. Learn faster. Repeat.") — counting those as entities inflates
 * exactly the class this feature is supposed to argue against.
 *
 * The rule: a sentence-initial run counts only if it is multi-word ("Stack
 * Overflow published…") or an acronym/product token ("GPT-4 shipped…"). A
 * lone capitalized word at a sentence start is presumed to be grammar.
 */
function countEntities(text: string): number {
  let count = 0;
  for (const sentence of text.split(/(?<=[.!?])\s+|\n+/)) {
    const trimmed = sentence.trim();

    // An all-caps sentence is shouting, not a run of acronyms. Scoring
    // "THIS IS A GAME CHANGER" as five entity mentions would read the loudest
    // slop as the most informative text in the corpus.
    const letters = trimmed.replace(/[^\p{L}]/gu, "");
    if (letters.length >= 4 && letters === letters.toUpperCase()) continue;

    const matches = trimmed.match(CAPITALIZED_RUN);
    if (!matches) continue;

    for (const match of matches) {
      if (trimmed.startsWith(match)) {
        const isMultiWord = /\s/.test(match.trim());
        // Acronyms and alphanumeric product names stay distinctive even in
        // first position, since grammar never produces "GPT-4" or "AWS".
        const isDistinctive = /[A-Z]{2,}|\d/.test(match);
        if (!isMultiWord && !isDistinctive) continue;
      }
      count++;
    }
  }
  return count;
}

/** Second-person imperative framing: "you should", "start doing", "never do". */
const PRESCRIPTIVE_PATTERNS: RegExp[] = [
  /\byou (?:should|must|need to|have to|ought to)\b/gi,
  /\b(?:never|always) (?:do|say|use|make|forget|underestimate)\b/gi,
  /\bstop (?:doing|saying|using|being)\b/gi,
  /\bstart (?:doing|saying|using|being)\b/gi,
  /\bhere(?:'s| is) how to\b/gi,
];

function countPrescriptive(text: string): number {
  let count = 0;
  for (const pattern of PRESCRIPTIVE_PATTERNS) {
    count += (text.match(pattern) ?? []).length;
  }
  return count;
}

/** Compute all informational features for a post. */
export function extractInformational(
  stats: TextStats,
  context: { linkCount: number } = { linkCount: 0 },
): InformationalFeatures {
  const { text, lower, words } = stats;
  const wordCount = Math.max(words.length, 1);

  const vague = countPhrases(lower, VAGUE_QUANTIFIERS);

  // Pronoun mix distinguishes lived anecdote from generic advice. Neither is
  // slop by itself, so this is carried as a descriptor, not a penalty.
  let firstPerson = 0;
  let secondPerson = 0;
  for (const word of words) {
    if (word === "i" || word === "my" || word === "me" || word === "mine") firstPerson++;
    else if (word === "you" || word === "your" || word === "yours") secondPerson++;
  }
  const pronouns = firstPerson + secondPerson;

  const uniqueWords = new Set(words).size;

  return {
    numberDensity: saturate(ratio(countNumbers(text) * 100, wordCount), NUMBER_SCALE),
    entityDensity: saturate(ratio(countEntities(text) * 100, wordCount), ENTITY_SCALE),
    citationDensity: saturate(context.linkCount, 1),
    vagueness: saturate(vague.count, VAGUE_SCALE),
    firstPersonRatio: ratio(firstPerson, Math.max(pronouns, 1)),
    prescriptiveness: saturate(ratio(countPrescriptive(text) * 100, wordCount), 2),
    // Very short posts trivially score high diversity, so the raw ratio is only
    // meaningful past a few dozen words.
    lexicalDiversity: words.length >= 20 ? ratio(uniqueWords, wordCount) : 0.5,
  };
}
