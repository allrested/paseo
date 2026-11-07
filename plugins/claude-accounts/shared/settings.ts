import { defineSettings } from "@getpaseo/plugin";
import { z } from "zod";

/** The provider that launches the main Claude Code profile. */
export const MAIN_PROVIDER = "claude";
/** The default-account value that picks the signed-in account with the most room. */
export const AUTO_ACCOUNT = "auto";
export const ACCOUNT_NAME_MAX = 32;

// `claude-<name>` has to stay a valid provider id (/^[a-z][a-z0-9-]*$/) and `~/.claude-<name>` a
// plain directory name.
export const AccountNameSchema = z
  .string()
  .max(ACCOUNT_NAME_MAX, `Use at most ${ACCOUNT_NAME_MAX} characters`)
  .regex(
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    "Use lowercase letters and digits, with single dashes between them",
  );

export function accountProvider(name: string): string {
  return `${MAIN_PROVIDER}-${name}`;
}

const DefaultAccountSchema = z
  .string()
  .regex(/^(auto|claude|claude-[a-z0-9]+(?:-[a-z0-9]+)*)$/, "Pick Auto or one of the accounts");

export const claudeAccountsSettings = defineSettings({
  id: "default-account",
  scope: "host",
  version: 1,
  schema: z.object({ defaultAccount: DefaultAccountSchema.default(MAIN_PROVIDER) }),
});
