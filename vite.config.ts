import { defineConfig } from "vite-plus";

export default defineConfig({
  staged: {
    "*": "vp check --fix",
    "packages/zexplorer/**/*.css": "vp run zexplorer#lint:css --",
  },
  fmt: {
    ignorePatterns: ["entharion/**"],
  },
  lint: {
    ignorePatterns: ["entharion/**"],
    jsPlugins: [{ name: "vite-plus", specifier: "vite-plus/oxlint-plugin" }],
    rules: {
      "typescript/explicit-function-return-type": "error",
      "typescript/no-unnecessary-type-assertion": "error",
      "typescript/no-unnecessary-condition": "error",
      "vite-plus/prefer-vite-plus-imports": "error",
      "typescript/no-floating-promises": "error",
      "typescript/no-misused-promises": "error",
      "typescript/strict-void-return": "error",
      "typescript/no-explicit-any": "error",
      "typescript/await-thenable": "error",
      "typescript/no-unused-vars": "error",
      "prefer-const": "error",
      "no-var": "error",
      eqeqeq: "error",
      "typescript/consistent-type-imports": "warn",
      "typescript/no-non-null-assertion": "warn",
    },
    options: { typeAware: true, typeCheck: true },
  },
  run: {
    cache: true,
  },
});
