import { describe, expect, it } from "vitest";
import { normalizeText, stripSeeMore } from "./normalize";

describe("normalizeText", () => {
  it("strips zero-width and bidi control characters", () => {
    const dirty = ["he", "​", "llo", "﻿", " wor", "­", "ld"].join("");
    expect(normalizeText(dirty)).toBe("hello world");
  });

  it("preserves emoji, which are a structural signal", () => {
    expect(normalizeText("🚀 Growth\n✅ Wins")).toBe("🚀 Growth\n✅ Wins");
  });

  it("preserves single and double newlines", () => {
    expect(normalizeText("Hook.\n\nLine one.\nLine two.")).toBe(
      "Hook.\n\nLine one.\nLine two.",
    );
  });

  it("collapses three or more newlines to a paragraph break", () => {
    expect(normalizeText("A.\n\n\n\nB.")).toBe("A.\n\nB.");
  });

  it("collapses horizontal whitespace runs but not newlines", () => {
    expect(normalizeText("a  \t  b\n\nc")).toBe("a b\n\nc");
  });

  it("trims each line and the whole body", () => {
    expect(normalizeText("  lead  \n   tail   \n")).toBe("lead\ntail");
  });

  it("normalizes CRLF line endings", () => {
    expect(normalizeText("a\r\nb")).toBe("a\nb");
  });

  it("returns an empty string for whitespace-only input", () => {
    expect(normalizeText("  \n\n \t ")).toBe("");
  });
});

describe("stripSeeMore", () => {
  it("removes an ellipsis see-more affordance", () => {
    expect(stripSeeMore("Great insight…see more")).toEqual({
      text: "Great insight",
      truncated: true,
    });
  });

  it("removes a dotted see-more affordance regardless of case", () => {
    expect(stripSeeMore("Great insight... See More")).toEqual({
      text: "Great insight",
      truncated: true,
    });
  });

  it("reports untruncated text unchanged", () => {
    expect(stripSeeMore("A complete post.")).toEqual({
      text: "A complete post.",
      truncated: false,
    });
  });

  it("leaves a mid-text 'see more' alone", () => {
    const text = "I want to see more of this in my feed.";
    expect(stripSeeMore(text)).toEqual({ text, truncated: false });
  });
});
