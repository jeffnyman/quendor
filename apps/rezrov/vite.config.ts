import { defineConfig } from "vite-plus";

export default defineConfig({
  // quendor is a workspace package resolved to its built `dist`. Vite would
  // otherwise pre-bundle it and cache that bundle keyed on the version string
  // — and since the local package shares the published version (0.2.0), edits
  // to the engine wouldn't invalidate the cache. Excluding it makes Vite serve
  // the live dist through its normal module graph instead, so rebuilds show up
  // with no stale pre-bundle to clear.
  optimizeDeps: {
    exclude: ["quendor"],
  },
});
