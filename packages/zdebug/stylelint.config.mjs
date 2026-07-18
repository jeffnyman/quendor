// Workaround: cosmiconfig's TS loader calls ts.findConfigFile, which isn't
// implemented in TypeScript 7.0's native/Go compiler API. Revert to
// stylelint.config.ts once TypeScript ships a stable programmatic API
// (targeted for 7.1) — check when the Dependabot `typescript` group PR
// bumps past 7.0. https://github.com/microsoft/typescript-go/issues

export default {
  extends: ["stylelint-config-standard"],
  plugins: ["stylelint-use-nesting"],
};
