import type { Source } from "../shared/contracts.js";

/** One task as a tracker returned it, before it is shaped for a picker. */
export interface Issue {
  source: Source;
  /** What people call it: `BWLT-12`, `group/project#7`. */
  key: string;
  title: string;
  status: string;
  url: string;
  /** Plain text; empty when the task has none. */
  description: string;
  /** Extra facts for the attachment, as name and value. */
  details: Array<[name: string, value: string]>;
  /** What the task's branch name starts with. */
  branchPrefix: string;
}

export interface Tracker {
  source: Source;
  /** The open tasks of the signed-in user that match `query`; all of them for an empty query. */
  search(query: string): Promise<Issue[]>;
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
