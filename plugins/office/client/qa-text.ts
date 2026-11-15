import type { WorkspaceCheck, WorkspaceScript } from "../shared/contracts.js";
import type { HostNote } from "./machine-text.js";
import { agentTitle, type OfficeModel, type OfficeRoom } from "./model.js";
import { pullRequestRef, teamName } from "./standup-text.js";

/** A check that fails or runs: the ones a pipeline is watched for. */
export interface QaCheck {
  name: string;
  /** How it stands, its workflow and how long it took: "Fails · CI · 3m 12s". */
  detail: string;
  failing: boolean;
  /** The run's page on the forge, where its log is; null when the forge gave none. */
  url: string | null;
}

/** An agent's test run, while the agent is at it. */
export interface QaTest {
  agentId: string;
  line: string;
  state: "running" | "passed" | "failed";
}

export interface QaScript {
  name: string;
  /** "Service, running, healthy, port 5173". */
  line: string;
  /** An unhealthy service, or a run that ended with an error. */
  troubled: boolean;
  /** It has run in a terminal, so its output can be read. */
  readable: boolean;
}

/** What one team has under test: its pipeline, its agents' test runs and its scripts. */
export interface QaTeam {
  roomId: string;
  name: string;
  /** The pull request's checks counted: "#128: 2 fail, 1 running, 14 pass". Null without any. */
  checks: string | null;
  checksFail: boolean;
  /** The checks that fail, then the ones that run. */
  runs: QaCheck[];
  tests: QaTest[];
  scripts: QaScript[];
}

const COUNT_WORDS: readonly [WorkspaceCheck["status"], string][] = [
  ["failure", "fail"],
  ["pending", "running"],
  ["success", "pass"],
  ["skipped", "skipped"],
  ["cancelled", "cancelled"],
];

function checkOf(run: WorkspaceCheck): QaCheck {
  const failing = run.status === "failure";
  return {
    name: run.name,
    detail: [failing ? "Fails" : "Running", run.workflow ?? null, run.duration ?? null]
      .filter((part) => part !== null)
      .join(" · "),
    failing,
    url: run.url,
  };
}

function checksOf(room: OfficeRoom): Pick<QaTeam, "checks" | "checksFail" | "runs"> {
  const request = room.workspace?.pullRequest;
  // A merged or closed pull request's checks are history.
  const runs =
    request && (request.state === "open" || request.state === "draft") ? request.runs : [];
  if (!request || runs.length === 0) return { checks: null, checksFail: false, runs: [] };
  const counts = COUNT_WORDS.map(([status, word]) => {
    const n = runs.filter((run) => run.status === status).length;
    return n === 0 ? null : `${n} ${word}`;
  }).filter((part) => part !== null);
  const ref = pullRequestRef(request);
  return {
    checks: `${ref.charAt(0).toUpperCase()}${ref.slice(1)}: ${counts.join(", ")}`,
    checksFail: runs.some((run) => run.status === "failure"),
    runs: runs.filter((run) => run.status === "failure" || run.status === "pending").map(checkOf),
  };
}

const TEST_WORDS: Readonly<Record<QaTest["state"], string>> = {
  running: "tests running",
  passed: "tests pass",
  failed: "tests fail",
};

function testsOf(room: OfficeRoom): QaTest[] {
  const tests: QaTest[] = [];
  for (const { agent, step } of room.rows) {
    if (step?.kind !== "test") continue;
    const title = agentTitle(agent);
    const state = step.result ?? "running";
    tests.push({ agentId: agent.id, line: `${title}: ${TEST_WORDS[state]}`, state });
  }
  return tests;
}

function runState(script: WorkspaceScript): string {
  if (script.running) return "running";
  if (script.exitCode === null) return script.terminalId === null ? "not started" : "stopped";
  return script.exitCode === 0 ? "ended" : `ended with an error (exit ${script.exitCode})`;
}

function scriptOf(script: WorkspaceScript): QaScript {
  const live = script.running;
  return {
    name: script.name,
    line: [
      script.kind === "service" ? "Service" : "Script",
      runState(script),
      live ? script.health : null,
      live && script.port !== null ? `port ${script.port}` : null,
    ]
      .filter((part) => part !== null)
      .join(", "),
    troubled: live
      ? script.health === "unhealthy"
      : script.exitCode !== null && script.exitCode !== 0,
    readable: script.terminalId !== null,
  };
}

/** Every room with a pipeline, a test run or a script, in the office's order. */
export function qaTeams(model: Pick<OfficeModel, "rooms">): QaTeam[] {
  const teams: QaTeam[] = [];
  for (const room of model.rooms) {
    const checks = checksOf(room);
    const tests = testsOf(room);
    const scripts = (room.workspace?.scripts ?? []).map(scriptOf);
    if (checks.checks === null && tests.length === 0 && scripts.length === 0) continue;
    teams.push({
      roomId: room.id,
      name: teamName({ name: room.name, project: room.subtitle }),
      ...checks,
      tests,
      scripts,
    });
  }
  return teams;
}

function totals(teams: readonly QaTeam[]): { failing: number; running: number } {
  let failing = 0;
  let running = 0;
  for (const team of teams) {
    failing += team.runs.filter((run) => run.failing).length;
    failing += team.tests.filter((test) => test.state === "failed").length;
    failing += team.scripts.filter((script) => script.troubled).length;
    running += team.runs.filter((run) => !run.failing).length;
    running += team.tests.filter((test) => test.state === "running").length;
  }
  return { failing, running };
}

/** What is under test in a few words, for the strip; null when nothing is. */
export function qaNote(teams: readonly QaTeam[]): HostNote | null {
  if (teams.length === 0) return null;
  const { failing, running } = totals(teams);
  if (failing > 0) return { text: `${failing} failing`, tone: "warning" };
  if (running > 0) return { text: `${running} running`, tone: "muted" };
  return { text: "Nothing fails", tone: "muted" };
}

/** The card's first line: what fails and what runs, over all teams. */
export function qaSummary(teams: readonly QaTeam[]): string {
  if (teams.length === 0) return "No checks, test runs or scripts on this host.";
  const { failing, running } = totals(teams);
  const parts = [failing === 0 ? "Nothing fails" : `${failing} failing`];
  if (running > 0) parts.push(`${running} running`);
  return parts.join(", ");
}

/** What the card says under its first line: what the three kinds of rows are. */
export const QA_HELP =
  "Checks are the pull request's pipeline, and a check's link opens its run and its log on the forge. Test runs are the agents' own. A script's log is read from its terminal on this host.";

/**
 * The line over a log that was read: how much of it this is and when it was read. `time` is
 * the reading's time as the device writes one.
 */
export function logCaption(lines: number, earlier: number, time: string): string {
  if (lines === 0) return `No output yet, read at ${time}`;
  const count = lines === 1 ? "1 line" : `${lines} lines`;
  if (earlier === 0) return `${count}, read at ${time}`;
  return `The newest ${count}, read at ${time}. The terminal has ${earlier} more above.`;
}
