// https://tsdown.dev/reference/api/Interface.Options
import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["./src/index.ts"],
  platform: "neutral",
  dts: {
    oxc: true,
  },
});
