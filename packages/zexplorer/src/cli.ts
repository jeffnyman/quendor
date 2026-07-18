#!/usr/bin/env node

async function main(): Promise<void> {
  const [command, ..._rest] = process.argv.slice(2);

  switch (command) {
    default:
      console.error("usage: zexp <command> [args]");
      console.error("commands:");

      process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
