import type { JanitorAction, JanitorResult } from "../shared/contracts.js";
import { errorMessage } from "./errors.js";

export interface JanitorPorts {
  /** The agent's status now; null when this daemon does not know the id. */
  status(agentId: string): Promise<string | null>;
  /** The names of the slash commands the agent's session has, without the slash. */
  commands(agentId: string): Promise<readonly string[]>;
  /** Sends a prompt as the user would. */
  send(agentId: string, text: string): Promise<void>;
}

// What providers call the command; the first one a session has is sent.
const COMMANDS: Readonly<Record<JanitorAction, readonly string[]>> = {
  clean: ["compact"],
  reset: ["clear", "new", "reset"],
};
const BUSY: Readonly<Record<JanitorAction, string>> = {
  clean: "The agent is at work; clean its context once its turn has ended",
  reset: "The agent is at work; reset it once its turn has ended",
};
// An agent that stopped on an error takes a prompt, and a context that grew too long is one
// reason it stops.
const TAKES_A_PROMPT: ReadonlySet<string> = new Set(["idle", "error"]);
const NO_COMMAND: Readonly<Record<JanitorAction, string>> = {
  clean: "This agent's provider has no command that compacts a conversation",
  reset: "This agent's provider has no command that starts a new conversation",
};

/**
 * Tidies one agent's conversation with its provider's own command, sent as a prompt. Never an
 * agent at work: the command would cut its turn, and an agent that waits for an answer is in
 * one. The answer says the command was sent; the provider does the work after it.
 */
export async function tidyAgent(
  ports: JanitorPorts,
  agentId: string,
  action: JanitorAction,
): Promise<JanitorResult> {
  const fail = (error: string): JanitorResult => ({ ok: false, error });
  try {
    const status = await ports.status(agentId);
    if (status === null) return fail("This host does not know the agent");
    if (!TAKES_A_PROMPT.has(status)) return fail(BUSY[action]);
    const has = new Set(await ports.commands(agentId));
    const command = COMMANDS[action].find((name) => has.has(name));
    if (command === undefined) return fail(NO_COMMAND[action]);
    await ports.send(agentId, `/${command}`);
    return { ok: true, error: null };
  } catch (error) {
    return fail(errorMessage(error));
  }
}
