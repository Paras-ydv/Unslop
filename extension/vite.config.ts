import { defineConfig } from "vite";
import { resolve } from "node:path";

/**
 * Two entry points with incompatible output formats:
 *
 *   content.js — MV3 content scripts cannot be ES modules, so this must be a
 *                single self-contained IIFE with no code splitting.
 *   popup.html — an ordinary page, which can use a module script.
 *
 * Rollup cannot emit both formats from one build, so the popup is built by a
 * second pass (`build:popup`) that writes into the same `dist` without clearing
 * it. `BUILD_TARGET` selects which pass this invocation runs.
 */
const target = process.env["BUILD_TARGET"] ?? "content";

const shared = {
  resolve: {
    alias: { "@shared": resolve(import.meta.dirname, "../shared") },
  },
};

export default defineConfig(
  target === "popup"
    ? {
        ...shared,
        // The popup's HTML lives beside its script, so that directory is the
        // build root; `dist` is then resolved back out to the package root.
        root: resolve(import.meta.dirname, "src/popup"),
        publicDir: false,
        // Relative, so the emitted <script src> resolves next to popup.html
        // rather than at the extension root.
        base: "./",
        build: {
          outDir: resolve(import.meta.dirname, "dist"),
          emptyOutDir: false,
          target: "chrome120",
          minify: false,
          rollupOptions: {
            input: resolve(import.meta.dirname, "src/popup/popup.html"),
            output: { entryFileNames: "popup.js", assetFileNames: "[name][extname]" },
          },
        },
      }
    : {
        ...shared,
        build: {
          outDir: "dist",
          // Never clear `dist`: the popup is emitted by a separate pass, and a
          // content rebuild that wipes it leaves the manifest pointing at a
          // missing popup.html — which Chrome rejects, disabling the whole
          // extension including the content script. `npm run clean` handles
          // the rare case where a stale-file purge is actually wanted.
          emptyOutDir: false,
          target: "chrome120",
          minify: false,
          rollupOptions: {
            input: resolve(import.meta.dirname, "src/content/index.ts"),
            output: { format: "iife", entryFileNames: "content.js" },
          },
        },
      },
);
