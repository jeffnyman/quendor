#!/usr/bin/env node

async function cmdHeader(_path: string): Promise<void> {
  throw new Error("not implemented");
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);

  switch (command) {
    case "header": {
      const path = rest[0];

      if (!path) {
        console.error("usage: zexp header <story-file>");
        process.exitCode = 1;
        return;
      }

      await cmdHeader(path);

      return;
    }
    default:
      console.error("usage: zexp <command> [args]");
      console.error("commands:");
      console.error("  header <story-file>    parse and print the story header");

      process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
