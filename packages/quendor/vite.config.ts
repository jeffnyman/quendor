import { defineConfig } from "vite-plus";

export default defineConfig({
  pack: {
    entry: ["src/index.ts", "src/node.ts", "src/cli.ts", "src/qdor.ts"],
    dts: {
      tsgo: true,
    },
    exports: {
      exclude: ["cli", "qdor"],
      bin: {
        quendor: "./src/cli.ts",
        qdor: "./src/qdor.ts",
      },
    },
  },
  lint: {
    options: {
      typeAware: true,
      typeCheck: true,
    },
  },
  fmt: {},
  test: {
    reporters: ["default", "html"],

    outputFile: {
      html: "./test-results/index.html",
    },

    coverage: {
      reportsDirectory: "./test-results/coverage",
    },
  },
});
