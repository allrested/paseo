import { describe, expect, it } from "vitest";
import { ServerDefinitionSchema, sharedMcpSettings } from "./settings.js";

const SERVER_ID_MESSAGE =
  "Server id must start with a lowercase letter and use only lowercase letters, digits, and dashes";

const context7 = {
  id: "context7",
  label: "Context7",
  command: "npx -y @upstash/context7-mcp@4.0.4 --transport http --port 8932",
  port: 8932,
};

const gitlab = {
  id: "gitlab",
  label: "GitLab",
  command: "npx -y @zereight/mcp-gitlab@2.1.52",
  port: 8933,
};

interface Issue {
  path: PropertyKey[];
  message: string;
}

function settingsIssues(input: unknown): Issue[] {
  const result = sharedMcpSettings.schema.safeParse(input);
  if (result.success) return [];
  return result.error.issues.map((issue) => ({ path: issue.path, message: issue.message }));
}

describe("sharedMcpSettings", () => {
  it("defaults to no servers", () => {
    expect(sharedMcpSettings.schema.parse({})).toEqual({ servers: [] });
  });

  it("fills definition defaults and leaves unset optional fields out", () => {
    expect(ServerDefinitionSchema.parse(context7)).toStrictEqual({
      ...context7,
      env: {},
      healthPath: "/mcp",
      requires: [],
      enabled: true,
    });
  });

  it("accepts servers with distinct ids and ports", () => {
    expect(settingsIssues({ servers: [context7, gitlab] })).toEqual([]);
  });

  it("rejects a duplicate id", () => {
    expect(settingsIssues({ servers: [context7, { ...gitlab, id: "context7" }] })).toEqual([
      { path: ["servers", 1, "id"], message: 'Server id "context7" is used more than once' },
    ]);
  });

  it("rejects a duplicate port", () => {
    expect(settingsIssues({ servers: [context7, { ...gitlab, port: 8932 }] })).toEqual([
      {
        path: ["servers", 1, "port"],
        message: 'Port 8932 is used by both "context7" and "gitlab"',
      },
    ]);
  });

  it.each(["Context7", "7up", "has_underscore", "-dash", ""])("rejects the id %j", (id) => {
    expect(settingsIssues({ servers: [{ ...context7, id }] })).toEqual([
      { path: ["servers", 0, "id"], message: SERVER_ID_MESSAGE },
    ]);
  });
});
