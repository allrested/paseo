/**
 * An agent's calls that only some hosts have: the fork's SDK adds them, stock Paseo's does not.
 * The office asks for each where it uses it and offers the action only when it is there.
 */
export interface AgentExtras {
  /** Stops the running turn. */
  cancel?: () => Promise<void>;
  /** Closes the agent's runtime; its next prompt resumes it. */
  closeRuntime?: () => Promise<void>;
}

/** The call, bound to its object, or null on a host without it. */
export function extra<Name extends keyof AgentExtras>(
  ref: object,
  name: Name,
): NonNullable<AgentExtras[Name]> | null {
  const value: unknown = (ref as Record<string, unknown>)[name];
  if (typeof value !== "function") return null;
  return (value as () => Promise<void>).bind(ref) as NonNullable<AgentExtras[Name]>;
}
