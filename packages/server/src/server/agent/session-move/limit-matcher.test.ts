import { describe, expect, it } from "vitest";
import { isUsageLimitError } from "./limit-matcher.js";

describe("isUsageLimitError", () => {
  it.each([
    "Claude AI usage limit reached|1762300800",
    "You've hit your 5-hour limit. Resets at 2pm",
    "Weekly limit reached for Opus",
    "You've hit your usage limit. Upgrade or try again in 3 hours.",
    "stream error: exceeded retry limit, last status: 429 Too Many Requests",
    "Rate limit reached for gpt-5.6-codex",
    "Error: insufficient_quota",
    "Monthly quota exceeded",
    "You've hit your five-hour limit",
  ])("recognises %s", (message) => {
    expect(isUsageLimitError(message)).toBe(true);
  });

  it.each([
    "Requested fake provider failure",
    "ENOENT: no such file or directory",
    "Context window limit: compacting conversation",
    "Process exited with code 1",
    "Unterminated quotation mark",
  ])("ignores %s", (message) => {
    expect(isUsageLimitError(message)).toBe(false);
  });
});
