import { execSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Codebase-intelligence gate, coverage-aware.
//
// fallow's CRAP score is only meaningful with real coverage. Without it, fallow
// estimates coverage from export references and treats private functions as
// untested — so a private, well-tested method (e.g. Machine.execute) is scored
// as if it had no tests at all. Feeding real Istanbul coverage fixes that.
//
// fallow's --coverage takes a single file, but coverage is emitted per package,
// so we regenerate it, merge the per-package maps (their file keys are
// disjoint), and run the full fallow suite against the merged map.

const COVERAGE_FILES = [
  "packages/quendor/test-quendor/coverage/coverage-final.json",
  "packages/zexplorer/test-zexplorer/coverage/coverage-final.json",
];

execSync("vp run -r test --coverage", { stdio: "inherit" });

const merged = {};

for (const file of COVERAGE_FILES) {
  if (!existsSync(file)) {
    throw new Error(`Expected coverage file not found: ${file} (did the test run emit coverage?)`);
  }

  Object.assign(merged, JSON.parse(readFileSync(file, "utf8")));
}

const mergedPath = join(tmpdir(), "quendor-fallow-coverage.json");
writeFileSync(mergedPath, JSON.stringify(merged));

execSync(`vp exec fallow --coverage "${mergedPath}"`, { stdio: "inherit" });
