const SLUG_MAX = 40;

/** A title as a branch-safe tail: ASCII letters and digits, dashes between words. */
function slug(title: string): string {
  const words = title
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (words.length <= SLUG_MAX) return words;
  // Cut at a word, unless the first word alone is too long.
  const cut = words.slice(0, SLUG_MAX + 1);
  const end = cut.lastIndexOf("-");
  return end > 0 ? cut.slice(0, end) : words.slice(0, SLUG_MAX);
}

/** The branch a task's workspace starts on, such as `BWLT-12-add-the-webhook`. */
export function taskBranch(prefix: string, title: string): string {
  const tail = slug(title);
  return tail ? `${prefix}-${tail}` : prefix;
}
