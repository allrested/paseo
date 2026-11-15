import type { Phase, Source, TaskKind } from "../shared/contracts.js";

export type { TaskKind };

/** One task as a tracker returned it, before it is shaped for a picker or the tasks screen. */
export interface Issue {
  source: Source;
  kind: TaskKind;
  /** Names the task to its tracker: `BWLT-12`, `issue:<project>:<iid>`, `mr:<project>:<iid>`. */
  id: string;
  /** What people call it: `BWLT-12`, `group/project#7`, `group/project!3`. */
  key: string;
  title: string;
  status: string;
  url: string;
  /** Plain text or Markdown; empty when the task has none. */
  description: string;
  /** Extra facts, as name and value. */
  details: Array<[name: string, value: string]>;
  /** What the task's branch name starts with. */
  branchPrefix: string;
  /** When it last changed, as an ISO time; absent when the tracker gave none. */
  updatedAt?: string;
  /** Why a merge request is listed: "Review requested", "Assigned to you". */
  note?: string;
  /** Where the status stands; absent when the tracker does not say. */
  phase?: Phase;
}

export interface Comment {
  id: string;
  author: string;
  /** An ISO time, or empty when the tracker gave none. */
  at: string;
  text: string;
}

/** A status the task can move to now. */
export interface StatusChange {
  /** Names the move to the tracker. */
  id: string;
  /** The status it ends in. */
  label: string;
}

export interface IssueDetail extends Issue {
  /** The newest comments, oldest first. */
  comments: Comment[];
  /** How many older comments the tracker holds beyond these. */
  earlierComments: number;
  changes: StatusChange[];
  /** The description and the comments are Markdown; plain text otherwise. */
  markdown: boolean;
}

export interface Tracker {
  source: Source;
  /** The open tasks of the signed-in user that match `query`; all of them for an empty query. */
  search(query: string): Promise<Issue[]>;
  /**
   * The open merge requests that wait for the signed-in user's review or are assigned to them.
   * Absent on a tracker that holds none.
   */
  mergeRequests?(query: string): Promise<Issue[]>;
  /** One task by its `Issue.id` and nothing else of it; null when it is gone or hidden. */
  find(id: string): Promise<Issue | null>;
  /** One task by its `Issue.id`, with its comments and the statuses it can move to. */
  detail(id: string): Promise<IssueDetail>;
  comment(id: string, text: string): Promise<void>;
  /** Moves the task by a `StatusChange.id` its detail listed. */
  change(id: string, change: string): Promise<void>;
  /** The name of the signed-in user. */
  account(): Promise<string>;
}

/** A failure whose message is written for the user and holds no secret. */
export class TrackerError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "TrackerError";
  }
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** A tracker's time as an ISO time. Jira writes `+0800`, which not every client's Date reads. */
export function isoTime(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  const time = Date.parse(value);
  return Number.isNaN(time) ? undefined : new Date(time).toISOString();
}
