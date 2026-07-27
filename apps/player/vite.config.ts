import { defineConfig } from "vite-plus";

export default defineConfig({
  // On GitHub Pages the player is served from a project subpath; the deploy
  // workflow sets PAGES_BASE to prefix every built asset URL. Local dev and CI
  // leave it unset and build at the root.
  base: process.env.PAGES_BASE ?? "/",

  // quendor is a workspace package resolved to its built `dist`. Excluding it
  // from pre-bundling makes Vite serve the live dist through its normal module
  // graph, so engine rebuilds show up without a stale pre-bundle to clear.
  optimizeDeps: {
    exclude: ["quendor"],
  },
  test: {
    coverage: {
      reportsDirectory: "./test-player/coverage",
    },
  },
});
