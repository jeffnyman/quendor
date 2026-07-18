<!--VITE PLUS START-->

# Using Vite+, the Unified Toolchain for the Web

This project is using Vite+, a unified toolchain built on top of Vite, Rolldown, Vitest, tsdown, Oxlint, Oxfmt, and Vite Task. Vite+ wraps runtime management, package management, and frontend tooling in a single global CLI called `vp`. Vite+ is distinct from Vite, and it invokes Vite through `vp dev` and `vp build`. Run `vp help` to print a list of commands and `vp <command> --help` for information about a specific command.

Docs are local at `node_modules/vite-plus/docs` or online at https://viteplus.dev/guide/.

## Review Checklist

- [ ] Run `vp install` after pulling remote changes and before getting started.
- [ ] Run `vp check` and `vp test` to format, lint, type check and test changes.
- [ ] Check if there are `vite.config.ts` tasks or `package.json` scripts necessary for validation, run via `vp run <script>`.
- [ ] If setup, runtime, or package-manager behavior looks wrong, run `vp env doctor` and include its output when asking for help.

<!--VITE PLUS END-->

## Dependency Management

This project uses [pnpm catalogs](https://pnpm.io/catalogs) to pin shared dependency versions in one place (`pnpm-workspace.yaml`). `catalogMode` is set to `strict`, so adding a dependency with a version that conflicts with an existing catalog entry fails with `ERR_PNPM_CATALOG_VERSION_MISMATCH` instead of silently installing a divergent version.

- [ ] When adding a dependency that already has (or should have) a catalog entry, use `vp add <dependency> --save-catalog --filter <workspace-package>` rather than a bare `vp add`/`pnpm add`.
- [ ] If a catalog-based add is rejected for a version mismatch, update the version in `pnpm-workspace.yaml`'s `catalog:` block first, then re-run the `--save-catalog` add to link the package to it.

## Cutting a Release

`main` is protected: direct pushes are rejected, and `bumpp` (used by `quendor`'s `release` script) can only push a commit and a tag together, not separately. Releasing `quendor` is therefore a two-step process:

- [ ] On a branch, run `pnpm run release` (from `packages/quendor`). This bumps the version and creates a commit, but does not tag or push. Open a PR and merge it like any other change.
- [ ] After that PR is merged, on an up-to-date `main`, create and push the tag against the commit that actually landed: `git tag quendor@X.Y.Z && git push origin quendor@X.Y.Z`. Tags are not covered by the branch ruleset, so this push is unaffected by it.

Do not tag before the version-bump commit is merged — depending on the PR merge method, the commit that lands on `main` may not be the same commit `bumpp` created on the branch.
