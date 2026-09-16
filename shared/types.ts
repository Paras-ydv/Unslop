/** Types shared between the extension and (eventually) the backend. */

/** Quality verdict shown to the user. */
export type Verdict = "green" | "yellow" | "red";

/** A post as extracted from the DOM, before any analysis. */
export interface ExtractedPost {
  /** Stable LinkedIn URN, or a content-derived fallback. See `derivePostId`. */
  id: string;
  /** Whether `id` came from a real URN. Fallback ids are less reliable for caching. */
  idIsStable: boolean;
  /** Normalized post body text. */
  text: string;
  /** Raw text before normalization, kept for debugging and labeling. */
  rawText: string;
  /** Author display name, when it could be read. */
  author: string | null;
  /** True when the body was collapsed behind "…see more" and could not be expanded. */
  truncated: boolean;
  /** Outbound link URLs found in the body. */
  links: string[];
  /** Whether the post carries an image, video, document, or poll. */
  hasMedia: boolean;
  /** True when the post is a reshare wrapping another post. */
  isReshare: boolean;
  /** Milliseconds spent extracting, for the performance budget. */
  extractionMs: number;
}

/** Per-signal contribution to a score, surfaced in the "Why?" panel. */
export interface Signal {
  /** Stable identifier, e.g. `"emoji_bullets"`. */
  key: string;
  /** Human-readable one-liner. */
  label: string;
  /** Signed contribution to the final score. Positive means more slop-like. */
  weight: number;
}

/** Output of the rule engine and, later, the model. */
export interface Classification {
  postId: string;
  verdict: Verdict;
  /** 0 = clearly valuable, 1 = clearly slop. */
  score: number;
  /** 0–1. Below the certainty threshold the post is escalated to the model. */
  confidence: number;
  /** Top contributing signals, strongest first. */
  signals: Signal[];
  /** Which stage produced this verdict. */
  source: "rules" | "model" | "backend";
}
