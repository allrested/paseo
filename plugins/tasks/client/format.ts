// Text for the tasks screen: sentence case, no trailing period.
import {
  SOURCE_NAME,
  requestName,
  type Source,
  type TaskComment,
  type TaskRow,
} from "../shared/contracts.js";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const RECENT_DAYS = 30;

// As the Feed and Search chats screens write it; a plugin's bundle holds its own folder only.
export function ago(iso: string, now: number): string {
  const ms = now - Date.parse(iso);
  if (ms < MINUTE) return "just now";
  if (ms < HOUR) return `${Math.floor(ms / MINUTE)} min ago`;
  if (ms < DAY) return `${Math.floor(ms / HOUR)} h ago`;
  if (ms < RECENT_DAYS * DAY) return `${Math.floor(ms / DAY)} d ago`;
  return `on ${iso.slice(0, 10)}`;
}

/**
 * A row's second line: how the task stands, why it is listed, when it changed, where it is. The
 * line is cut at the row's width, so the tracker's name, which the key already shows, is last;
 * and a merge request that is listed for a reason does not also say it is open.
 */
export function rowMeta(row: TaskRow, now: number): string {
  const parts: string[] = [];
  if (row.note === undefined || row.status !== "Open") parts.push(row.status);
  if (row.note !== undefined) parts.push(row.note);
  if (row.updatedAt !== undefined) parts.push(ago(row.updatedAt, now));
  parts.push(SOURCE_NAME[row.source]);
  return parts.join(" · ");
}

/** A row read aloud: the task, its mark when it has a workspace, and what pressing it does. */
export function rowLabel(row: Pick<TaskRow, "key" | "title">, hasWorkspace = false): string {
  return `${row.key} ${row.title}.${hasWorkspace ? " Has a workspace." : ""} Open the task`;
}

/** What a task is, above its title: "Jira issue", "GitLab merge request", "GitHub pull request". */
export function kindName(task: Pick<TaskRow, "source" | "kind">): string {
  return `${SOURCE_NAME[task.source]} ${task.kind === "mr" ? requestName(task.source) : "issue"}`;
}

/** The list's second section, named for what it holds: GitLab's requests, GitHub's, or both. */
export function requestsTitle(rows: ReadonlyArray<Pick<TaskRow, "source">>): string {
  const pulls = rows.some((row) => row.source === "github");
  const merges = rows.some((row) => row.source !== "github");
  if (pulls && merges) return "Pull and merge requests";
  return pulls ? "Pull requests" : "Merge requests";
}

export function commentMeta(comment: Pick<TaskComment, "author" | "at">, now: number): string {
  return comment.at === "" ? comment.author : `${comment.author} · ${ago(comment.at, now)}`;
}

/** Says where the comments that are not shown can be read. */
export function earlierComments(count: number, source: Source): string {
  const name = SOURCE_NAME[source];
  return count === 1
    ? `1 earlier comment is on ${name}`
    : `${count} earlier comments are on ${name}`;
}

/** What the list says when it holds nothing. */
export function emptyList(query: string): string {
  const text = query.trim();
  if (text === "") return "No open issues, merge requests or pull requests are assigned to you";
  return `Nothing matches "${text}"`;
}
