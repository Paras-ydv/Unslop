/**
 * Runs the popup build pass.
 *
 * A tiny wrapper rather than an inline `BUILD_TARGET=... vite build`, because
 * npm scripts run through cmd.exe on Windows, where that syntax is not valid.
 */
import { build } from "vite";

process.env.BUILD_TARGET = "popup";
await build();
