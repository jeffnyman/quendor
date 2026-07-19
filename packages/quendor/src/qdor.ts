#!/usr/bin/env node

// Separate file so this can be its own `bin` entry: two bin names
// pointing at the same source file collapse into one during pack.
export * from "./cli.ts";
