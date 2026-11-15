import type { Phase, Source, TaskKind } from "../shared/contracts.js";
import type { FileBytes } from "./http.js";

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

/** Where a new issue can go: a Jira or GitLab project, a GitHub repository. */
export interface Place {
  /** Names the place to its tracker. */
  id: string;
  label: string;
}

/** A kind of issue a place takes: Jira's issue types. */
export interface IssueKind {
  id: string;
  label: string;
}

export interface NewIssue {
  /** A `Place.id`. */
  place: string;
  /** An `IssueKind.id`, for a tracker that has kinds. */
  kind?: string;
  title: string;
  /** Plain text or Markdown, as the tracker writes; empty for none. */
  description: string;
}

/** An image of a task's description. */
export interface TaskImage {
  /** Names the image to its tracker. */
  id: string;
  name: string;
}

/** A task's page shows no image over this. */
export const IMAGE_MAX_BYTES = 4 * 1024 * 1024;

export interface IssueDetail extends Issue {
  /** The newest comments, oldest first. */
  comments: Comment[];
  /** How many older comments the tracker holds beyond these. */
  earlierComments: number;
  changes: StatusChange[];
  /** The description and the comments are Markdown; plain text otherwise. */
  markdown: boolean;
  /** The signed-in user is among the task's assignees. */
  assignedToMe: boolean;
  /** The images of the description, which `Tracker.image` reads. */
  images: TaskImage[];
}

/** One thread of a merge request's review: a first note and the answers to it. */
export interface ReviewThread {
  /** Names the thread to its tracker. */
  id: string;
  resolved: boolean;
  /** Who resolved it, when the tracker says. */
  resolvedBy?: string;
  /** The file and line it is about; absent for a thread about the whole request. */
  where?: string;
  /** Oldest first. */
  notes: Comment[];
}

export interface ReviewThreads {
  /** As the tracker lists them: oldest first. */
  threads: ReviewThread[];
  /** The tracker holds more than were read. */
  more: boolean;
}

/** The review threads of a merge request, on a tracker that keeps them. */
export interface Review {
  /** The threads of one merge request, by its `Issue.id`. */
  list(id: string): Promise<ReviewThreads>;
  reply(id: string, thread: string, text: string): Promise<void>;
  /** Resolves a thread, or opens it again. */
  resolve(id: string, thread: string, resolved: boolean): Promise<void>;
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
  /** The projects or repositories a new issue can go to, that match `query`. */
  places(query: string): Promise<Place[]>;
  /** The kinds of issue a place takes. Absent on a tracker whose issues have no kinds. */
  kinds?(place: string): Promise<IssueKind[]>;
  /** Makes an issue and answers with its `Issue.id`. */
  create(issue: NewIssue): Promise<string>;
  /** Puts the signed-in user among the task's assignees. */
  assign(id: string): Promise<void>;
  /** One image a task's detail listed, by its `TaskImage.id`. */
  image(id: string, image: string): Promise<FileBytes>;
  /** Absent on a tracker whose review threads Paseo does not read. */
  review?: Review;
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
