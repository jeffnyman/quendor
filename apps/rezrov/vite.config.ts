import { defineConfig } from "vite-plus";

export default defineConfig({
  // On GitHub Pages, rezrov is served from a project subpath
  // (https://jeffnyman.github.io/quendor/), so the deploy workflow sets
  // PAGES_BASE=/quendor/ to prefix every built asset URL. Local dev and CI
  // leave it unset and build at the root.
  base: process.env.PAGES_BASE ?? "/",

  // quendor is a workspace package resolved to its built `dist`. Vite would
  // otherwise pre-bundle it and cache that bundle keyed on the version string
  // — and since the local package shares the published version (0.2.0), edits
  // to the engine wouldn't invalidate the cache. Excluding it makes Vite serve
  // the live dist through its normal module graph instead, so rebuilds show up
  // with no stale pre-bundle to clear.
  optimizeDeps: {
    exclude: ["quendor"],
  },
  test: {
    coverage: {
      reportsDirectory: "./test-rezrov/coverage",
    },
  },
});
