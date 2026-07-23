#!/usr/bin/env node

// The `quendor` player bin: a thin entrypoint that runs main(). The logic lives
// in ./cli.ts, which the tests import without side effects — invoking main()
// here (not there) keeps that module import-safe, and needs no `import.meta.main`
// guard, since a bin file is only ever executed, never imported.
import { main } from "./cli.ts";

/* v8 ignore start -- @preserve */
main().catch((err) => {
  console.error(`quendor: ${(err as Error).message}`);
  process.exitCode = 1;
});
/* v8 ignore stop */
