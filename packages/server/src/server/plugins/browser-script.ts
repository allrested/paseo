// Fork delta (office stream): a built-in plugin's script for a page in the daemon's Chromium,
// built with the esbuild that compiles plugin sources.
import { loadEsbuild } from "./compiler-esbuild.js";

/** One self-contained browser script (IIFE, es2020, minified) built from `entryPath`. */
export async function bundleBrowserScript(entryPath: string): Promise<string> {
  const result = await loadEsbuild().build({
    entryPoints: [entryPath],
    bundle: true,
    format: "iife",
    platform: "browser",
    target: "es2020",
    minify: true,
    write: false,
    logLevel: "silent",
  });
  const output = result.outputFiles[0];
  if (!output) throw new Error(`No script was built from ${entryPath}`);
  return output.text;
}
