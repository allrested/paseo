import {
  CHECKLIST_STEP_MAX,
  CHECKLIST_TEXT_MAX,
  type ChecklistStep,
  type Checklists,
} from "../shared/contracts.js";
import type { ActivityKind, ActivityStep, TestResult } from "../shared/names.js";
import { errorMessage } from "./errors.js";
import type { Timers } from "./timers.js";

export type { ActivityStep };

/** At most one read per agent per interval (spec: once per 5 s per agent). */
export const ACTIVITY_INTERVAL_MS = 5000;
/** Timeline items read from the tail of each running agent. */
export const ACTIVITY_TAIL_LIMIT = 10;
// Providers put free text (a command, a path) in a tool name; only identifier-like names are shown.
const TOOL_NAME = /^[A-Za-z0-9_.:-]{1,60}$/;

/** The fields read from a timeline item; every AgentTimelineItem satisfies it. */
export interface ActivityItem {
  type: string;
  name?: unknown;
  status?: unknown;
  callId?: unknown;
  /** A tool call's detail as the host normalises it: `{ type: "shell", command }` and the like. */
  detail?: unknown;
  /** A todo item's steps: `{ text, completed, status? }` each, as the provider wrote them. */
  items?: unknown;
}

/** One line for the newest item it recognises. Never quotes prompt or tool text. */
export function describeActivity(items: readonly ActivityItem[]): string | null {
  for (const item of items.toReversed()) {
    if (item.type === "tool_call") {
      const verb = item.status === "running" ? "Running" : "Ran";
      const tool =
        typeof item.name === "string" && TOOL_NAME.test(item.name) ? item.name : "a tool";
      return `${verb} ${tool}`;
    }
    if (item.type === "assistant_message") return "Writing a reply";
    if (item.type === "reasoning") return "Thinking";
    if (item.type === "user_message") return "Reading the prompt";
  }
  return null;
}

/** The host's kinds of tool call that are one kind of work each. */
const DETAIL_KINDS: Readonly<Record<string, ActivityKind>> = {
  read: "read",
  edit: "edit",
  write: "write",
  fetch: "web",
  sub_agent: "subagent",
  plan: "plan",
};

// What a command line puts before the command: `sudo`, `env`, `NAME=value`.
const PREFIX = String.raw`(?:(?:sudo|env)(?:\s+-\S+)*\s+|\w+=\S*\s+)*`;
// Where a command starts: the start of the string, or after `;`, `&&`, `||`, `|`, `(` or a newline,
// past its prefix.
const COMMAND_START = String.raw`(?:^|[;&|(\n])\s*` + PREFIX;

// `make deploy`, `just deploy`, and their `deploy-…` targets.
const DEPLOY_TARGET = new RegExp(
  COMMAND_START + String.raw`(?:make|just)\b[^\n;|&]*?\sdeploy(?:-[\w-]*)?(?=$|[\s;|&)])`,
);
// A push of a version tag, or a command whose job is to put something live.
const DEPLOY = [
  /\bgit\s+push\b[^\n;|&]*(?:--tags\b|\bv\d+\.\d+\.\d+)/,
  /\b(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:deploy|publish)\b/,
  /\b(?:vercel|netlify|fly|flyctl|firebase|wrangler|serverless|sls|cdk)\s+(?:--prod\b|deploy\b|publish\b)/,
  /\bkubectl\s+apply\b/,
  /\bhelm\s+(?:upgrade|install)\b/,
  /\b(?:terraform|tofu)\s+apply\b/,
  /\bterraspace\s+up\b/,
  /\bdocker\s+push\b/,
  /\bgh\s+release\s+create\b/,
  DEPLOY_TARGET,
  // A Dokploy redeploy: an HTTP client calls its API's method, which may come anywhere on its line.
  new RegExp(
    COMMAND_START +
      String.raw`(?:curl|wget|https?|xh)\b[^\n;|&]*?\b(?:compose|application)\.(?:deploy|redeploy)\b`,
  ),
  // A run of a workflow named for a deploy or a release: the name is the first argument.
  new RegExp(
    COMMAND_START +
      String.raw`gh\s+workflow\s+run\s+(?:"[^"\n]*(?:deploy|release)|'[^'\n]*(?:deploy|release)|[^\s"';|&]*(?:deploy|release))`,
    "i",
  ),
];
// A script whose file name starts with `deploy`, where a command starts or after what runs it:
// `scripts/deploy.sh pos`, `./deploy-prod.mjs`, `node deploy.mjs`. A name without an extension
// needs a folder before it (`bin/deploy`): the word alone is no deploy.
const RUNS = String.raw`(?:^|[;&|(]|(?<![\w./-])(?:sudo|env|time|nohup|exec|bash|sh|zsh|node|bun|tsx|python3?|ruby|php)\b(?:\s+-\S+)*)\s*(?:\w+=\S*\s+)*`;
const DEPLOY_SCRIPT = new RegExp(
  RUNS +
    String.raw`(?:(?:\.{0,2}/)?(?:[\w.@-]+/)*deploy[\w-]*\.(?:sh|bash|zsh|mjs|cjs|js|ts|py|rb|php)|(?:\.{1,2}/|[\w.@-]+/)(?:[\w.@-]+/)*deploy[\w-]*)(?=$|[\s;|&)])`,
);
// A skill is a folder with this file in it; the file is the skill.
const SKILL_FILE = /(?:^|[\\/])SKILL\.md$/;
const SKILL_IN_COMMAND = /(?:^|[\s/'"])SKILL\.md\b/;
const TEST =
  /\b(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?test\b|\b(?:vitest|jest|pytest)\b|\bplaywright\s+test\b|\b(?:go|cargo)\s+test\b|\bgradlew?\s+\S*test\b/;

// A deploy that only says what it would do: a check, a dry run, a list. To make, just and a
// deploy script `-n` is a dry run too, past the prefix (`sudo -n` asks for no password); to
// kubectl and helm it names a namespace.
const DRY_RUN = /\s--(?:dry-?run|check|list|just-print|recon)(?=$|[\s=])/;
const DRY_RUN_SHORT = /\s-n(?=$|\s)/;
const LEADING_PREFIX = new RegExp(String.raw`^[\s(]*` + PREFIX);

/** One command of a command line puts something live: a deploy that is not a dry run. */
function deploys(command: string): boolean {
  const runner = DEPLOY_TARGET.test(command) || DEPLOY_SCRIPT.test(command);
  if (!runner && !DEPLOY.some((pattern) => pattern.test(command))) return false;
  const bare = command.replace(LEADING_PREFIX, "");
  return !DRY_RUN.test(command) && !(runner && DRY_RUN_SHORT.test(bare));
}

/** What a shell command is for. The command is read here and goes no further. */
function commandKind(command: string): ActivityKind {
  // Each command of the line on its own: a dry run's flag says nothing of the next command.
  if (command.split(/[;&|\n]/).some(deploys)) return "deploy";
  if (/\bgit\s+push\b/.test(command)) return "push";
  if (/\bgit\s+commit\b/.test(command)) return "commit";
  if (TEST.test(command)) return "test";
  return SKILL_IN_COMMAND.test(command) ? "skill" : "command";
}

/** A tool's own name: an MCP tool's is the part after its server's (`mcp__server__tool`). */
function ownName(name: string): string {
  return name.startsWith("mcp__") ? name.split("__").slice(2).join("__") : name;
}

// A tool that puts something live says so first: `deploy_service`, `release-app`, `publish`.
const DEPLOY_TOOL = /^(?:deploy|release|publish|rollout)(?:$|[_-])/i;

/** A tool the host has no kind for, placed by its name. */
function namedKind(name: unknown): ActivityKind {
  if (typeof name !== "string") return "tool";
  if (name === "Skill") return "skill";
  if (/^(?:TodoWrite|todo_write|update_plan)$/.test(name)) return "plan";
  if (/^(?:Task|Agent)$/.test(name)) return "subagent";
  if (/^(?:WebSearch|WebFetch|web_search|web_fetch)$/.test(name)) return "web";
  if (DEPLOY_TOOL.test(ownName(name))) return "deploy";
  return "tool";
}

function field(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null ? Reflect.get(value, key) : undefined;
}

function toolKind(item: ActivityItem): ActivityKind {
  const type = field(item.detail, "type");
  if (type === "shell") {
    const command = field(item.detail, "command");
    return typeof command === "string" ? commandKind(command) : "command";
  }
  if (type === "search") {
    return field(item.detail, "toolName") === "web_search" ? "web" : "search";
  }
  const filePath = field(item.detail, "filePath");
  if (typeof filePath === "string" && SKILL_FILE.test(filePath)) return "skill";
  return (typeof type === "string" ? DETAIL_KINDS[type] : undefined) ?? namedKind(item.name);
}

/** The kinds of work whose end is told: a test run's on the test board, a deploy's by the rocket. */
const ENDS: ReadonlySet<ActivityKind> = new Set(["test", "deploy"]);

/** How a call ended: by its exit code when the host has one, else by the call's status. */
function resultOf(item: ActivityItem): TestResult | null {
  if (item.status === "canceled") return null;
  const exitCode = field(item.detail, "exitCode");
  if (item.status === "failed" || (typeof exitCode === "number" && exitCode !== 0)) return "failed";
  return item.status === "completed" ? "passed" : null;
}

function stepOf(item: ActivityItem): ActivityStep {
  const kind = toolKind(item);
  const key = typeof item.callId === "string" && item.callId !== "" ? item.callId : kind;
  const result = ENDS.has(kind) ? resultOf(item) : null;
  return result === null ? { kind, key } : { kind, key, result };
}

/** The ids of the tool calls in a tail: what a read has seen, for the read after it. */
export function callsIn(items: readonly ActivityItem[]): Set<string> {
  const calls = new Set<string>();
  for (const item of items) {
    if (item.type === "tool_call" && typeof item.callId === "string" && item.callId !== "") {
      calls.add(item.callId);
    }
  }
  return calls;
}

/**
 * The newest tool call as a step. It is the step while it is the newest item: the agent is at
 * it. Once the agent has written or thought since, it is the step only when the read before
 * (`seen`, that read's `callsIn`) had not seen it: a search or a fetch often starts and ends
 * between two reads, and would never be told. Without `seen` there is no read before, and an
 * agent that writes is at no step. A prompt after the call is a new turn, and no step. The key
 * is the call's id, so two calls of one tool are two steps; a provider that numbers no calls
 * gives the kind, and then only a change of kind is a new step, and a call it has moved on from
 * cannot be told. A test run or a deploy that has ended says how.
 */
export function describeStep(
  items: readonly ActivityItem[],
  seen?: ReadonlySet<string>,
): ActivityStep | null {
  let movedOn = false;
  for (const item of items.toReversed()) {
    if (item.type === "tool_call") {
      if (!movedOn) return stepOf(item);
      const id = item.callId;
      const fresh = seen !== undefined && typeof id === "string" && id !== "" && !seen.has(id);
      return fresh ? stepOf(item) : null;
    }
    if (item.type === "user_message") return null;
    if (item.type === "assistant_message" || item.type === "reasoning") movedOn = true;
  }
  return null;
}

/**
 * The step to report after `before`. An agent has often moved on by the read after its tests or
 * its deploy ended, so one last seen running is looked up again, and its end is reported for one
 * read before whatever came after it. A cancelled one, and one that left the tail, end without a
 * word.
 */
export function nextStep(
  before: ActivityStep | undefined,
  items: readonly ActivityItem[],
  seen?: ReadonlySet<string>,
): ActivityStep | null {
  const step = describeStep(items, seen);
  if (
    before === undefined ||
    !ENDS.has(before.kind) ||
    before.result !== undefined ||
    step?.key === before.key
  ) {
    return step;
  }
  const run = items.find((item) => item.type === "tool_call" && item.callId === before.key);
  const result = run === undefined ? null : resultOf(run);
  return result === null ? step : { ...before, result };
}

/**
 * A step as the office sends it: its text's first line, cut to the most it sends. Null for a
 * finished step, and for one with no text to show.
 */
function checklistStep(entry: unknown): ChecklistStep | null {
  const text = field(entry, "text");
  if (typeof text !== "string") return null;
  const status = field(entry, "status");
  // Either one saying finished wins: providers do not keep the pair consistent.
  const finished = field(entry, "completed") === true || status === "completed";
  if (finished) return null;
  const line = text.split(/[\r\n]/, 1)[0].trim();
  if (line === "") return null;
  const shown =
    line.length > CHECKLIST_TEXT_MAX ? `${line.slice(0, CHECKLIST_TEXT_MAX - 1)}…` : line;
  return { text: shown, status: status === "in_progress" ? "in_progress" : "pending" };
}

/** The unfinished steps of the newest todo item in a tail; null when the tail has none. */
export function readChecklist(items: readonly ActivityItem[]): ChecklistStep[] | null {
  const todo = items.findLast((item) => item.type === "todo");
  if (todo === undefined) return null;
  if (!Array.isArray(todo.items)) return [];
  const entries: readonly unknown[] = todo.items;
  const steps: ChecklistStep[] = [];
  for (const entry of entries) {
    const step = checklistStep(entry);
    if (step !== null) steps.push(step);
    if (steps.length === CHECKLIST_STEP_MAX) break;
  }
  return steps;
}

/** What the poller knows of each running agent: its line, and its step when it is at one. */
export type ActivityLines = Readonly<Record<string, string>>;
export type ActivitySteps = Readonly<Record<string, ActivityStep>>;

export interface ActivityPorts {
  /** Ids of the agents running now. */
  running(): readonly string[];
  tail(agentId: string): Promise<readonly ActivityItem[]>;
  timers: Timers;
  log(message: string): void;
  /**
   * `checklists` holds each agent read this round whose tail has a todo item, `[]` when all its
   * steps are finished; an agent whose read failed, or whose tail has none, is absent.
   */
  onChange(activity: ActivityLines, doing: ActivitySteps, checklists: Readonly<Checklists>): void;
}

export interface ActivityPoller {
  stop(): void;
}

function sameLines(left: ActivityLines, right: ActivityLines) {
  const leftKeys = Object.keys(left);
  if (leftKeys.length !== Object.keys(right).length) return false;
  return leftKeys.every((key) => left[key] === right[key]);
}

function sameSteps(left: ActivitySteps, right: ActivitySteps) {
  const leftKeys = Object.keys(left);
  if (leftKeys.length !== Object.keys(right).length) return false;
  return leftKeys.every(
    (key) =>
      left[key]?.kind === right[key]?.kind &&
      left[key]?.key === right[key]?.key &&
      left[key]?.result === right[key]?.result,
  );
}

/** Reads now, then every interval after the previous read finished, until stopped. */
export function startActivityPoller(ports: ActivityPorts): ActivityPoller {
  let stopped = false;
  let cancel: (() => void) | null = null;
  let previous: ActivityLines = {};
  let previousSteps: ActivitySteps = {};
  let previousChecklists = "{}";
  // The calls each agent's last read saw, kept while the poller runs: an agent's next turn is
  // read against them too. A prompt ends the look back, so an old turn's call is never told.
  const seenCalls = new Map<string, ReadonlySet<string>>();

  async function readOne(
    agentId: string,
    next: Record<string, string>,
    steps: Record<string, ActivityStep>,
    checklists: Checklists,
  ): Promise<void> {
    try {
      const items = await ports.tail(agentId);
      const line = describeActivity(items);
      if (line !== null) next[agentId] = line;
      const seen = seenCalls.get(agentId);
      const step = nextStep(previousSteps[agentId], items, seen);
      if (step !== null) steps[agentId] = step;
      const checklist = readChecklist(items);
      if (checklist !== null) checklists[agentId] = checklist;
      const calls = callsIn(items);
      // A call held back for a run's end has not been told: it stays new for the next read.
      const newest = describeStep(items, seen);
      if (newest !== null && newest.key !== step?.key) calls.delete(newest.key);
      seenCalls.set(agentId, calls);
    } catch (error) {
      if (!stopped) ports.log(`[office] activity of ${agentId}: ${errorMessage(error)}`);
      const kept = previous[agentId];
      if (kept !== undefined) next[agentId] = kept;
      const keptStep = previousSteps[agentId];
      if (keptStep !== undefined) steps[agentId] = keptStep;
    }
  }

  async function tick(): Promise<void> {
    const next: Record<string, string> = {};
    const steps: Record<string, ActivityStep> = {};
    const checklists: Checklists = {};
    for (const agentId of ports.running()) {
      if (stopped) return;
      await readOne(agentId, next, steps, checklists);
    }
    const checklistsText = JSON.stringify(checklists);
    const unchanged =
      sameLines(previous, next) &&
      sameSteps(previousSteps, steps) &&
      checklistsText === previousChecklists;
    if (stopped || unchanged) return;
    previous = next;
    previousSteps = steps;
    previousChecklists = checklistsText;
    ports.onChange(next, steps, checklists);
  }

  function runLogged(): void {
    run().catch((error: unknown) => ports.log(`[office] activity failed: ${errorMessage(error)}`));
  }

  async function run(): Promise<void> {
    try {
      await tick();
    } catch (error) {
      ports.log(`[office] activity failed: ${errorMessage(error)}`);
    }
    if (!stopped) cancel = ports.timers.setTimeout(runLogged, ACTIVITY_INTERVAL_MS);
  }

  runLogged();
  return {
    stop() {
      stopped = true;
      cancel?.();
      cancel = null;
    },
  };
}
