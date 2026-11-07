import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";
import { AccountNameSchema } from "./settings.js";

/** The account's tightest usage window, as the daemon picks it (`tightestUsageWindow`). */
export const AccountUsageSchema = z.object({
  usedPct: z.number(),
  windowLabel: z.string(),
  planLabel: z.string().nullable(),
});

export const AccountSchema = z.object({
  provider: z.string(),
  directory: z.string(),
  label: z.string(),
  main: z.boolean(),
  signedIn: z.boolean(),
  loginExpired: z.boolean(),
  /** The provider exists, launches this directory, is on and has loaded. */
  providerReady: z.boolean(),
  usage: AccountUsageSchema.nullable(),
  agents: z.object({ total: z.number(), busy: z.number() }),
  problems: z.array(z.string()),
});

export const MoveJobSchema = z.object({
  from: z.string(),
  to: z.string(),
  /** Agents on `from` that were idle when the job started: the ones it moves. */
  total: z.number(),
  /** Agents on `from` that were in a turn when the job started; they stay where they are. */
  busy: z.number(),
  moved: z.number(),
  /** Moves that continued through a history handoff instead of the native session. */
  handedOff: z.number(),
  /** Idle agents that started a turn or went away before their move. */
  skipped: z.number(),
  failed: z.array(z.object({ agentId: z.string(), error: z.string() })),
  done: z.boolean(),
});

export const ActionResultSchema = z.object({
  ok: z.boolean(),
  error: z.string().nullable(),
  /** The workspace whose terminal runs `claude auth login`, or null when none opened. */
  loginWorkspaceId: z.string().nullable(),
});

export const AccountListSchema = z.object({
  accounts: z.array(AccountSchema),
  /** The first usage lookup error, such as "Usage is off on this host.". */
  usageError: z.string().nullable(),
  moveJob: MoveJobSchema.nullable(),
});

export const MoveIdleResultSchema = z.object({
  ok: z.boolean(),
  error: z.string().nullable(),
  job: MoveJobSchema.nullable(),
});

export type AccountUsage = z.output<typeof AccountUsageSchema>;
export type Account = z.output<typeof AccountSchema>;
export type MoveJob = z.output<typeof MoveJobSchema>;
export type ActionResult = z.output<typeof ActionResultSchema>;
export type AccountList = z.output<typeof AccountListSchema>;
export type MoveIdleResult = z.output<typeof MoveIdleResultSchema>;

export const listAccountsRpc = defineRpc({
  name: "claude-accounts.list.request",
  input: z.object({}),
  output: AccountListSchema,
});

export const addAccountRpc = defineRpc({
  name: "claude-accounts.add.request",
  input: z.object({ name: AccountNameSchema }),
  output: ActionResultSchema,
});

export const signInRpc = defineRpc({
  name: "claude-accounts.sign-in.request",
  input: z.object({ provider: z.string() }),
  output: ActionResultSchema,
});

export const moveIdleRpc = defineRpc({
  name: "claude-accounts.move-idle.request",
  input: z.object({ from: z.string(), to: z.string() }),
  output: MoveIdleResultSchema,
});
