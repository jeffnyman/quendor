# Screen model

How quendor represents the Z-Machine screen, and why. Scope: **V3, V4, V5**
(the versions quendor plays). V6's pixel/8-window model (§8.8) is out of scope
but the grid below is its groundwork.

## The problem this replaces

quendor originally modelled the **upper window as a cell grid** and the **lower
window as a text stream** (`onLowerOutput`). That is clean and sufficient for the
common case — a one-line status bar over scrolling prose — but it cannot
represent a _persistent shared surface_, and real games need one.

Concrete failure: the _All Roads_ (v5) title page does this —

```
erase_window 0
split_window 14        ; a TALL upper window
set_window 1
set_cursor … ; print … ; draw the quote box at rows 3–12
set_window 0
split_window 1         ; SHRINK the upper window back to one row
… print the menu into the lower window …
```

It draws a box in a 14-row upper window, then shrinks the upper window to one
row, expecting the box to **stay on screen** as a backdrop while the menu prints
below it. quendor's `split_window` discarded the rows that left the upper window,
so the box vanished from the model; meanwhile the CLI had already painted it to
the terminal, and the menu rendered on top → a collision. Frotz and Parchment
render it correctly because they model the **whole screen as one grid**.

## What the spec actually says

From the Z-Machine Standard 1.1, §8 (screen model):

- **§8.7.2.1** (V4/5): the upper window is printed "on the top n lines of the
  screen, **overlaying any text which is already there, having been printed in
  the lower window some time ago**." The screen is one shared surface.
- **§8.7.2** (V4/5) has **no "clear on split" clause.** Contrast **§8.6.1.1.2**
  (V3): "When a screen split takes place in Version 3, the upper window is
  cleared." So in V4/5 a split — including re-splitting _smaller_ — must not
  erase; content persists.
- **§8.7.2.2**: shrinking a split does not erase; it only moves the _lower_
  cursor down if the upper window would swallow it. In V5 the lower cursor may
  sit on any line not under the upper window.
- **§8.7.3.1**: the lower window scrolls when text reaches its bottom; the upper
  window **never** scrolls.
- **§8.7.3.2–4**: `erase_window` / `erase_line` clear a region to the background
  (never reversed), with version-specific cursor moves (§8.7.3.2.1, §8.7.3.3).
- **§8.6.1.1.1 / §8.7.2.1**: printing to the upper window overlays what's there.

The conclusion is forced: **one persistent character grid**, with the two
windows as row-range _views_ into it.

## The model (`screen.ts`)

A single grid, `grid: Cell[][]` of `height × width`, plus a divider:

- **Upper window** = rows `[0, upperHeight)`. Cursor-addressable (`set_cursor`),
  overlays, never scrolls.
- **Lower window** = rows `[upperHeight, height)`. Its own cursor; wraps and
  scrolls _within its region_.

`Cell = { ch, style, fg, bg }`. Blank cells use the current background, never
reverse (§8.7.3.1/2).

### Operations

| Opcode           | Behaviour                                                                                                                                                                                                                                                              |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `split_window n` | Set `upperHeight = n`. **V3** clears the upper rows (§8.6.1.1.2); **V4/5** leaves the grid untouched (§8.7.2). If the split would swallow the lower cursor (`lowerRow < upperHeight`), move it to `upperHeight` (§8.7.2.2). **No rows are discarded** — the fix.       |
| `set_window w`   | Select a window. Selecting the upper window resets its cursor to its top-left (§8.7.2); the lower keeps its cursor.                                                                                                                                                    |
| `set_cursor r c` | Moves the **upper** window's cursor; no effect when the lower window is selected (§8.7.2.3). Illegal outside the upper window's current size.                                                                                                                          |
| `print`          | Upper: overlay cells at the cursor, clip at the right edge, never scroll (§8.7.3.1). Lower: write cells, wrap, scroll its region on overflow, **and still emit `onLowerOutput`** (the transcript).                                                                     |
| `erase_window`   | `-1` clears the whole screen, collapses the upper window to 0, selects the lower, homes the lower cursor (V5) / bottom-left (V4) (§8.7.3.3). `-2` clears both regions, keeps the split. `0`/`1` clear that region. Erased-window cursor → top-left in V5 (§8.7.3.2.1). |
| `erase_line`     | Clear from the cursor to the right edge (§8.7.3.4).                                                                                                                                                                                                                    |
| `buffer_mode`    | Lower-window word- vs char-wrap; buffering never applies to the upper window (§8.7.2.5).                                                                                                                                                                               |

## Paging — the `[More]` prompt

Once quendor owns the screen (curses renderer), it must page long output itself,
as frotz does: when a screenful of text scrolls past without the player getting
a turn, pause with `[More]` and wait for a key. **Policy in the model, mechanism
in the host.**

- `screen.ts` tracks `linesSinceInput`, incremented on every lower-window scroll.
  When it reaches `lowerHeight − 1` (a row reserved for the prompt) it fires a
  host hook `onMore()` and resets. The threshold is **dynamic**:
  `lowerHeight = height − upperHeight`.
- The counter resets when the game reads input (`sread`/`read_char`) and after a
  `[More]` keypress. Only the lower window scrolls, so only it pages.
- `onMore` **defaults to a no-op.** The interactive CLI installs a real blocking
  prompt (draw `[More]`, read a key, erase, continue); `runAcceptance` installs
  nothing, so scripted/golden runs page straight through and never hang.
- `[More]` is display chrome — it is **never** printed to `onOutput`, so
  transcripts and goldens are unaffected.

## Host contract

The decoupling that protects the acceptance work:

- **`onOutput` is unchanged** — the logical stream of text _printed to the lower
  window_, independent of the grid. It is the transcript.
- The host reads **`grid` + the cursor** for _display_. Grid = screen;
  `onOutput` = history of printed characters. They coexist.

## Renderer impact

- **CLI (`cli.ts`)** becomes curses-style: diff the grid frame-to-frame, emit
  cursor-addressed updates, park the hardware cursor at the lower cursor, and
  implement `onMore` as the real prompt. Enter on the alternate screen buffer
  (`ESC[?1049h`), restore on exit — which also retires the scroll-region teardown
  hack. Trade-off: no native terminal scrollback during play (frotz's deal); the
  transcript lives in `onOutput` / `script`.
- **rezrov** renders the whole grid to the DOM (it already renders the upper
  grid); a web grid is a natural fit, and it can auto-page or add its own affordance.

## Acceptance / goldens

Small, by design. `onOutput` stays the lower-window printed-text stream, so
`runAcceptance` is unchanged and the czech golden still matches (pure lower-window
text). Upper-window content (title boxes, status lines) never appears in a
transcript — correct, and consistent with how the status line has always been
excluded. A separate _grid snapshot_ check can cover visual cases like the All
Roads title later.

## Phasing

1. **Grid model in `screen.ts`** + unit tests — pure, no renderer. Includes the
   scroll counter and the `onMore` hook (default no-op). Keeps emitting
   `onLowerOutput`, so `machine.ts`/`cli.ts` stay green.
2. **Point `machine.ts` at it** — the opcodes already call
   `split_window`/`set_cursor`/`print`; minimal change.
3. **Curses CLI renderer** + alt-screen + the real `[More]` prompt.
4. **rezrov** grid render.
5. **Verify** _All Roads_ renders correctly, plus a text-heavy scroll/`[More]`
   case; add a grid-snapshot check.
