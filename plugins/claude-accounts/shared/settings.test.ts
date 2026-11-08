import { describe, expect, it } from "vitest";
import { AccountNameSchema, accountProvider, claudeAccountsSettings } from "./settings.js";

const NAME_MESSAGE = "Use lowercase letters and digits, with single dashes between them";
const DEFAULT_MESSAGE = "Pick Auto or one of the accounts";

function nameIssues(input: unknown): string[] {
  const result = AccountNameSchema.safeParse(input);
  return result.success ? [] : result.error.issues.map((issue) => issue.message);
}

function settingsIssues(input: unknown): string[] {
  const result = claudeAccountsSettings.schema.safeParse(input);
  return result.success ? [] : result.error.issues.map((issue) => issue.message);
}

describe("AccountNameSchema", () => {
  it("accepts lowercase words joined by single dashes", () => {
    expect(nameIssues("work")).toEqual([]);
    expect(nameIssues("team-2")).toEqual([]);
    expect(nameIssues("a".repeat(32))).toEqual([]);
  });

  it("rejects names that would not make a provider id and a plain directory name", () => {
    expect(nameIssues("")).toEqual([NAME_MESSAGE]);
    expect(nameIssues("Work")).toEqual([NAME_MESSAGE]);
    expect(nameIssues("-work")).toEqual([NAME_MESSAGE]);
    expect(nameIssues("work--2")).toEqual([NAME_MESSAGE]);
    expect(nameIssues("../x")).toEqual([NAME_MESSAGE]);
  });

  it("rejects names longer than 32 characters", () => {
    expect(nameIssues("a".repeat(33))).toEqual(["Use at most 32 characters"]);
  });
});

describe("claudeAccountsSettings", () => {
  it("is the host-scoped default-account setting, version 1", () => {
    expect(claudeAccountsSettings.id).toBe("default-account");
    expect(claudeAccountsSettings.scope).toBe("host");
    expect(claudeAccountsSettings.version).toBe(1);
    expect(accountProvider("work")).toBe("claude-work");
  });

  it("defaults to the main account", () => {
    expect(claudeAccountsSettings.schema.parse({})).toEqual({ defaultAccount: "claude" });
  });

  it("accepts Auto, the main provider and account providers", () => {
    expect(settingsIssues({ defaultAccount: "auto" })).toEqual([]);
    expect(settingsIssues({ defaultAccount: "claude" })).toEqual([]);
    expect(settingsIssues({ defaultAccount: accountProvider("work") })).toEqual([]);
    expect(settingsIssues({ defaultAccount: accountProvider("a".repeat(32)) })).toEqual([]);
  });

  it("rejects other providers", () => {
    expect(settingsIssues({ defaultAccount: "codex" })).toEqual([DEFAULT_MESSAGE]);
    expect(settingsIssues({ defaultAccount: "claude-" })).toEqual([DEFAULT_MESSAGE]);
    expect(settingsIssues({ defaultAccount: accountProvider("a".repeat(33)) })).toEqual([
      DEFAULT_MESSAGE,
    ]);
    expect(settingsIssues({ defaultAccount: "claude--x" })).toEqual([DEFAULT_MESSAGE]);
    expect(settingsIssues({ defaultAccount: "claude-A" })).toEqual([DEFAULT_MESSAGE]);
    expect(settingsIssues({ defaultAccount: "autox" })).toEqual([DEFAULT_MESSAGE]);
  });
});
