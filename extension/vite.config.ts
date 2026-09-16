import { defineConfig } from "vite";
import { resolve } from "node:path";

// MV3 content scripts cannot be ES modules, so the content bundle is emitted as
// a single self-contained IIFE with no code splitting.
export default defineConfig({
  resolve: {
    alias: {
      "@shared": resolve(import.meta.dirname, "../shared"),
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    target: "chrome120",
    minify: false,
    rollupOptions: {
      input: resolve(import.meta.dirname, "src/content/index.ts"),
      output: {
        format: "iife",
        entryFileNames: "content.js",
      },
    },
  },
});
