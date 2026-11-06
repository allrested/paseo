// Provider CLIs report an exhausted plan or rate limit only as free text on a failed turn.
// These patterns come from real Claude Code, Codex and OpenAI-compatible errors. "Context
// window limit" is deliberately not a usage limit: moving would not help it.
const USAGE_LIMIT_PATTERNS: readonly RegExp[] = [
  /usage limit/i,
  /\b(5|five)[- ]hour limit\b/i,
  /\bweekly limit\b/i,
  /\brate limit\b/i,
  /\b429\b/,
  /(?<![a-z])quotas?(?![a-z])/i,
];

export function isUsageLimitError(message: string): boolean {
  return USAGE_LIMIT_PATTERNS.some((pattern) => pattern.test(message));
}
