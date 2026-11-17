// The words the feed says, and nothing else: an event's text is built from this file alone, so
// no file name, command, prompt or permission detail can reach the screen. `activity-feed.ts`
// imports this module, never the other way round.
import type { PermissionKind } from "../shared/contracts.js";
import type { ActivityKind } from "../shared/names.js";

/**
 * What an event is: the office's step kinds, and the five moments around them. It lives here
 * because every one of them needs a word, and the feed module takes its list from this file.
 */
export type FeedKind =
  | ActivityKind
  | "started"
  | "finished"
  | "permission"
  | "error"
  | "subagent-started";

/** The feed's first line, before the office has changed under it. */
export const FEED_EMPTY = "Nothing yet since the office opened.";

/** A step's word: what the agent is at, in the office's own kind and no detail of the call. */
const STEP_WORDS: Readonly<Record<ActivityKind, string>> = {
  read: "Reading",
  search: "Searching",
  skill: "Using a skill",
  edit: "Editing",
  write: "Writing",
  command: "Running a command",
  web: "Searching the web",
  tool: "Using a tool",
  subagent: "Starting a sub-agent",
  plan: "Updating the plan",
  test: "Running tests",
  commit: "Committing",
  push: "Pushing",
  deploy: "Deploying",
};

export interface EventTextExtra {
  /** A permission's short title, or a sub-agent's name; absent when there is nothing to name. */
  title?: string;
  /** A permission's kind, which decides whether its title may be shown. */
  permissionKind?: PermissionKind;
  /** A step that ended badly: its word gets " failed". */
  failed?: boolean;
}

/**
 * A permission's line. Only a tool's or a mode's title is a short name; a question's title is the
 * question itself (Claude's AskUserQuestion) and a plan's can be prose too, so those, and a kind
 * not given, get their words alone.
 */
function permissionText({ title, permissionKind }: EventTextExtra): string {
  if (permissionKind === "question") return "Has a question";
  if (permissionKind === "plan") return "Has a plan to review";
  const named = permissionKind === "tool" || permissionKind === "mode" ? (title?.trim() ?? "") : "";
  return named === "" ? "Needs permission" : `Needs permission: ${named}`;
}

/** What one event says. */
export function eventText(kind: FeedKind, extra: EventTextExtra = {}): string {
  switch (kind) {
    case "started":
      return "Started working";
    case "finished":
      return "Finished";
    case "error":
      return "Stopped on an error";
    case "permission":
      return permissionText(extra);
    case "subagent-started": {
      const title = extra.title?.trim() ?? "";
      return title === "" ? "A sub-agent started" : `Started ${title}`;
    }
    default: {
      const word = STEP_WORDS[kind];
      return extra.failed === true ? `${word} failed` : word;
    }
  }
}
