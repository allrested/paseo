const DELETE = 0x7f;

/** Whether the text holds a character at or below the code, or the delete character. */
function hasCodeUpTo(text: string, limit: number): boolean {
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code <= limit || code === DELETE) return true;
  }
  return false;
}

/** A tab, a line break, or any other character that does not print. */
export function hasControlCharacter(text: string): boolean {
  return hasCodeUpTo(text, 0x1f);
}

export function hasSpaceOrControlCharacter(text: string): boolean {
  return hasCodeUpTo(text, 0x20);
}
