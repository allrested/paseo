import type { Account, MoveJob } from "../shared/rpc.js";
import { AUTO_ACCOUNT, AccountNameSchema } from "../shared/settings.js";

export interface SelectOption {
  label: string;
  value: string;
}

export interface MoveHintInput {
  idle: number;
  jobRunning: boolean;
  armed: boolean;
  /** Labels of the two accounts. */
  from: string;
  to: string;
}

// The plugin SDK has no confirm dialog, so Move asks for a second press within this window.
export const MOVE_CONFIRM_MS = 5_000;

const AUTO_OPTION: SelectOption = { label: "Auto", value: AUTO_ACCOUNT };

/** The row's hint: login or usage, agents, directory. */
export function describeAccount(account: Account): string {
  return [loginText(account), describeAgents(account.agents), account.directory].join(" · ");
}

function loginText(account: Account): string {
  if (!account.signedIn) return "Not signed in";
  if (account.loginExpired) return "Login expired";
  const { usage } = account;
  if (usage === null) return "Usage unknown";
  const used = `${usage.windowLabel} ${Math.round(usage.usedPct)}% used`;
  return usage.planLabel === null ? used : `${usage.planLabel} · ${used}`;
}

export function describeAgents(agents: Account["agents"]): string {
  if (agents.total === 0) return "No agents";
  const count = plural(agents.total, "agent");
  if (agents.busy === 0) return count;
  return agents.total === 1 ? `${count}, in a turn` : `${count}, ${agents.busy} in a turn`;
}

/** The row offers Sign in while the profile has no login or its login expired. */
export function needsSignIn(account: Account): boolean {
  return !account.signedIn || account.loginExpired;
}

/** Agents can start on, or move to, an account whose provider is ready and whose login holds. */
export function canTakeAgents(account: Account): boolean {
  return account.providerReady && account.signedIn && !account.loginExpired;
}

/** Auto, then every account. A saved account that is gone stays listed so the picker shows it. */
export function defaultAccountOptions(
  accounts: readonly Account[],
  saved: string | null,
): SelectOption[] {
  const options = [AUTO_OPTION, ...accounts.map((account) => toOption(account))];
  if (saved !== null && !options.some((option) => option.value === saved)) {
    options.push({ label: `${saved} (unavailable)`, value: saved });
  }
  return options;
}

/** The accounts that can take `from`'s idle agents. */
export function moveTargetOptions(accounts: readonly Account[], from: string): SelectOption[] {
  return accounts
    .filter((account) => account.provider !== from && canTakeAgents(account))
    .map((account) => toOption(account));
}

function toOption(account: Account): SelectOption {
  return { label: account.label, value: account.provider };
}

export function accountLabel(accounts: readonly Account[], provider: string): string {
  return accounts.find((account) => account.provider === provider)?.label ?? provider;
}

/** The move job's line above the rows. */
export function describeMoveJob(job: MoveJob, accounts: readonly Account[]): string {
  const from = accountLabel(accounts, job.from);
  const to = accountLabel(accounts, job.to);
  if (!job.done) {
    const current = Math.min(job.moved + job.skipped + job.failed.length + 1, job.total);
    return `Moving ${current} of ${plural(job.total, "idle agent")} from ${from} to ${to}...`;
  }
  const parts =
    job.total === 0
      ? [`No idle agents to move from ${from}`]
      : [`Moved ${job.moved} of ${plural(job.total, "idle agent")} from ${from} to ${to}`];
  if (job.handedOff > 0) {
    parts.push(`${plural(job.handedOff, "move")} continued through a history handoff`);
  }
  // The spec's "skipped and counted": agents in a turn when the job started stay where they are.
  if (job.busy > 0) {
    parts.push(`Skipped ${plural(job.busy, "agent")} in a turn`);
  }
  if (job.skipped > 0) {
    parts.push(`Skipped ${plural(job.skipped, "agent")} that started a turn or went away`);
  }
  const [firstFailure] = job.failed;
  if (firstFailure !== undefined) {
    parts.push(`${plural(job.failed.length, "move")} failed: ${firstFailure.error}`);
  }
  return sentences(parts);
}

// One clause reads as a label, without a period; several read as prose, each with one.
function sentences(parts: readonly string[]): string {
  const [first] = parts;
  if (parts.length === 1 && first !== undefined) return first;
  return parts.map((part) => (part.endsWith(".") ? part : `${part}.`)).join(" ");
}

/** Why `name` cannot name an account, or null. An empty field is not an error yet. */
export function nameError(name: string): string | null {
  if (name === "") return null;
  const parsed = AccountNameSchema.safeParse(name);
  // A failed parse always carries an issue; the first one is the message to show.
  return parsed.success ? null : (parsed.error.issues[0]?.message ?? null);
}

export function moveHint({ idle, jobRunning, armed, from, to }: MoveHintInput): string {
  if (jobRunning) return "Agents are still moving. Wait for that move to finish.";
  if (idle === 0) return "No idle agents on this account";
  if (armed) {
    return `Press again within ${MOVE_CONFIRM_MS / 1000} s to move ${plural(idle, "idle agent")} from ${from} to ${to}. Their background shells, watches and subagents stop.`;
  }
  return "Agents in a turn stay where they are";
}

export function moveActionLabel(pending: boolean, armed: boolean): string {
  if (pending) return "Moving...";
  return armed ? "Confirm move" : "Move";
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}
