import { defineConfig } from "vite-plus";

export default defineConfig({
  pack: {
    entry: ["src/index.ts", "src/node.ts", "src/quendor.ts", "src/qdor.ts"],
    dts: {
      tsgo: true,
    },
    exports: {
      exclude: ["quendor", "qdor"],
      bin: {
        qdor: "./src/qdor.ts",
        quendor: "./src/quendor.ts",
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
