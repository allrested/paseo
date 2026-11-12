// Text that agents read as lists of posts: a wake prompt and a board read. Post text and agent
// titles are written by agents, so neither may start a line that reads as another post.

/** A name on one line. */
export function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** Text whose lines after the first are indented under its entry. */
export function indented(text: string): string {
  return text.replace(/\r\n?|\n/g, "\n  ");
}
