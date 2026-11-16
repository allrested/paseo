// The two names every part of the office uses, in a file with no schema in it: code that needs
// only a name (the render page) must not load the wire contracts and their schema library.

/** The host-wide board. Every other board id is a workspace id. */
export const LOBBY = "lobby";
/** The author of a post the user made in the office. */
export const USER_AUTHOR = "user";

/**
 * What an agent's tool call is for, as far as the office tells it apart. The host works it out
 * and sends this word alone: never the file, the command or the address.
 */
export const ACTIVITY_KINDS = [
  "read",
  "search",
  "skill",
  "edit",
  "write",
  "command",
  "web",
  "tool",
  "subagent",
  "plan",
  "test",
  "commit",
  "push",
  "deploy",
] as const;
export type ActivityKind = (typeof ACTIVITY_KINDS)[number];

/** How a test run or a deploy ended. */
export const TEST_RESULTS = ["passed", "failed"] as const;
export type TestResult = (typeof TEST_RESULTS)[number];

/** An agent's newest tool call: what it is for, and a key that changes with every new call. */
export interface ActivityStep {
  kind: ActivityKind;
  key: string;
  /** Set on a test run or a deploy once it has ended. */
  result?: TestResult;
}
