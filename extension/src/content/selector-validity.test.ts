/**
 * Every selector this extension hands to `querySelector` must be valid CSS.
 *
 * This exists because a passing jsdom test is not evidence that it is. jsdom's
 * selector engine is more permissive than Chrome's: it happily accepted
 * `[class*='actor']a[href*="/in/"]`, which puts a type selector after an
 * attribute selector. Chrome rejects that with a `SyntaxError` — a DOMException
 * out of `querySelector` — and since extraction catches and logs rather than
 * throwing, the only symptom on the live feed was one opaque console line and
 * every post silently skipped.
 *
 * So the selectors are parsed here with lightningcss, which implements the
 * spec and therefore agrees with the browser. It is already present as a Vite
 * dependency; nothing is installed for this.
 */

import { describe, expect, it } from "vitest";
import { transform } from "lightningcss";
import { DOM_SELECTORS } from "./selectors";
import { AUTHOR_DOM_SELECTORS } from "./author";

/** Parse a selector the way a browser would. Returns an error message, or null. */
function selectorError(selector: string): string | null {
  try {
    transform({
      filename: "selector.css",
      code: Buffer.from(`${selector} { color: red }`),
      errorRecovery: false,
    });
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

const ALL: readonly string[] = [...DOM_SELECTORS, ...AUTHOR_DOM_SELECTORS];

describe("selector validity", () => {
  it("has selectors to check", () => {
    expect(ALL.length).toBeGreaterThan(20);
  });

  it.each(ALL)("parses: %s", (selector) => {
    expect(selectorError(selector)).toBeNull();
  });

  it("rejects the shape that actually broke, so this test can be trusted", () => {
    // If lightningcss ever stopped catching this, the suite above would go
    // quietly green while the bug came back.
    expect(selectorError(`[class*='actor']a[href*="/in/"]`)).not.toBeNull();
  });

  it("catches a comma-list interpolated into a compound selector", () => {
    // The other half of the same bug: only the first alternative keeps the
    // prefix, so the rest silently match anywhere in the document.
    const parts = 'a[href*="/in/"], a[href*="/company/"]';
    const composed = `[class*='actor'] ${parts}`;
    const alternatives = composed.split(",").map((s) => s.trim());
    expect(alternatives.filter((s) => s.startsWith("[class*='actor']"))).toHaveLength(1);
  });
});
