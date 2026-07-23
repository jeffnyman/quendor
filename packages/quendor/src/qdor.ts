#!/usr/bin/env node

// Second bin name (`qdor`) for the same player. Kept as its own file so pack
// emits a distinct bin; importing the entry is what runs the player.
import "./quendor.ts";
