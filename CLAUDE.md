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

## Verifying Changes

Bare `vp check`/`vp test` don't rebuild workspace dependencies first, so they can silently pass against a stale build of a package another one depends on. Run `vp run -w ready` instead — it rebuilds every package (in dependency order) before checking and testing, matching what CI actually does.

## Dependency Management

This project uses [pnpm catalogs](https://pnpm.io/catalogs) to pin shared dependency versions in one place (`pnpm-workspace.yaml`). `catalogMode` is set to `strict`, so adding a dependency with a version that conflicts with an existing catalog entry fails with `ERR_PNPM_CATALOG_VERSION_MISMATCH` instead of silently installing a divergent version.

- [ ] When adding a dependency that already has (or should have) a catalog entry, use `vp add <dependency> --save-catalog --filter <workspace-package>` rather than a bare `vp add`/`pnpm add`.
- [ ] If a catalog-based add is rejected for a version mismatch, update the version in `pnpm-workspace.yaml`'s `catalog:` block first, then re-run the `--save-catalog` add to link the package to it.

## Cutting a Release

`main` is protected: direct pushes are rejected, and `bumpp` (used by `quendor`'s `release` script) can only push a commit and a tag together, not separately. Releasing `quendor` is therefore a two-step process:

- [ ] On a branch, run `pnpm run release` (from `packages/quendor`). This bumps the version and creates a commit, but does not tag or push. Open a PR and merge it like any other change.
- [ ] After that PR is merged, on an up-to-date `main`, create and push the tag against the commit that actually landed: `git tag quendor@X.Y.Z && git push origin quendor@X.Y.Z`. Tags are not covered by the branch ruleset, so this push is unaffected by it.

Do not tag before the version-bump commit is merged — depending on the PR merge method, the commit that lands on `main` may not be the same commit `bumpp` created on the branch.

## Reference Material (`entharion`)

`entharion` is an optional git submodule (see the README's "Getting Started" section for how to check it out) holding Z-machine/IF reference material that isn't part of quendor's own source. It's organized by purpose:

- `specs/` — format specifications as PDFs: the Z-Machine Standard, Blorb, Quetzal (save files), and the older per-version Z-code specs (`spec-zip`, `spec-ezip`, `spec-xzip`, `spec-yzip`).
- `zcode-checkers/` (+ `-source`) — compliance test story files (czech, etude, gntests, strictz) for validating a Z-machine implementation against the spec, plus their Inform 6 source.
- `zcode-infocom/` (+ `-source`) — original Infocom-era game files (multiple Zork I releases/formats, including a `.zblorb`), plus ZIL source for two of them.
- `zcode-inform/` (+ `-source`) — modern Inform 6-compiled games, plus their `.inf` source.
- `ztools-source/` — C source for the classic ztools suite (`infodump`, `txd`, `check`, etc.), useful as a reference implementation.
- `tools-mac/` / `tools-win/` — compiled ztools binaries per platform.

- [ ] Before citing spec behavior in a comment, check the actual PDF in `entharion/specs/` rather than relying on general knowledge of the format. If no PDF-reading tool is available, extract text first, e.g. `pdftotext -layout <file> -`.
- [ ] `entharion` isn't checked out by a plain clone. If it's missing locally, say so rather than assuming the reference material doesn't exist for this project — the fix is `git submodule update --init`.
