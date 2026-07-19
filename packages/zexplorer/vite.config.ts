import { defineConfig } from "vite-plus";

export default defineConfig({
  pack: {
    entry: ["src/cli.ts"],
    tsconfig: "tsconfig.cli.json",
    outDir: "dist-cli",
  },
  test: {
    reporters: ["default", "html"],

    outputFile: {
      html: "./test-zexplorer/index.html",
    },

    coverage: {
      reportsDirectory: "./test-zexplorer/coverage",
    },
  },
});
