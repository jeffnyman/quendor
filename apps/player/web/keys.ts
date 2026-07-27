/** Map a browser keydown to a Z-Machine input (ZSCII) code, or null to ignore. */
export function keyToZscii(e: KeyboardEvent): number | null {
  switch (e.key) {
    case "Enter":
      return 13;
    case "Escape":
      return 27;
    case "Backspace":
      return 8;
    case "Tab":
      return 9;
    case "ArrowUp":
      return 129;
    case "ArrowDown":
      return 130;
    case "ArrowLeft":
      return 131;
    case "ArrowRight":
      return 132;
  }

  if (e.key.length === 1) {
    const code = e.key.charCodeAt(0);
    if (code >= 32 && code <= 126) return code; // printable ASCII/ZSCII
  }

  if (/^F([1-9]|1[0-2])$/.test(e.key)) {
    return 133 + Number(e.key.slice(1)) - 1; // F1..F12
  }

  return null;
}

/**
 * Whether a keystroke should be redirected into the command box: it isn't
 * already aimed there, the box is enabled, and it's a plain key (no modifier /
 * IME composition).
 */
export function shouldRedirectToInput(e: KeyboardEvent, input: HTMLInputElement): boolean {
  return (
    e.target !== input && !input.disabled && !e.metaKey && !e.ctrlKey && !e.altKey && !e.isComposing
  );
}
