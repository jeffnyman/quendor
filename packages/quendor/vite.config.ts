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
        qdor: "./src/qdor.ts",
        quendor: "./src/cli.ts",
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
      html: "./test-quendor/index.html",
    },

    coverage: {
      reportsDirectory: "./test-quendor/coverage",
    },
  },
});
