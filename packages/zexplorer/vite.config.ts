import { defineConfig } from "vite-plus";

export default defineConfig({
  pack: {
    entry: ["src/cli.ts"],
    tsconfig: "tsconfig.cli.json",
    outDir: "dist-cli",
  },
});
