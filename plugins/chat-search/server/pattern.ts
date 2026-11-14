// The words as a transcript stores them. A line holds a message as JSON text: a quote is \", a
// backslash \\, a line break \n. The pattern looks for that spelling, so grep can find the words
// in a file nobody has parsed.

const SPECIAL = /[.*+?^${}()|[\]\\]/g;
// JSON leaves a space as it is and escapes every other white space, so between two words a
// stored line has spaces, escaped line breaks and tabs, or a run of both.
const GAP = String.raw`(\\[nrtf]| )+`;

// A word as JSON spells it, with every character that means something in a pattern escaped.
function storedWord(word: string): string {
  return JSON.stringify(word).slice(1, -1).replace(SPECIAL, "\\$&");
}

/** An extended regular expression (grep -E) for the words, with any white space between them. */
export function grepPattern(words: string): string {
  return words.trim().split(/\s+/).map(storedWord).join(GAP);
}
