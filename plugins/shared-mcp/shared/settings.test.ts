import { describe, expect, it } from "vitest";
import { ServerDefinitionSchema, sharedMcpSettings } from "./settings.js";

const SERVER_ID_MESSAGE =
  "Server id must start with a lowercase letter and use only lowercase letters, digits, and dashes";
const ENV_NAME_MESSAGE = "Use letters, digits and underscores, not starting with a digit";
const RESERVED_ENV_MESSAGE =
  "PATH, HOME, NODE_OPTIONS and names starting with PASEO_, LD_ or DYLD_ are reserved";

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

  it("accepts bearer token variable names", () => {
    const bearerToken = { serverEnv: "STREAMABLE_HTTP_AUTH_TOKEN", agentEnv: "SHARED_MCP_TOKEN" };

    expect(settingsIssues({ servers: [{ ...gitlab, bearerToken }] })).toEqual([]);
  });

  it.each(["PATH", "HOME", "NODE_OPTIONS", "LD_PRELOAD", "DYLD_INSERT_LIBRARIES", "PASEO_HOME"])(
    "rejects the reserved agentEnv %j",
    (agentEnv) => {
      const bearerToken = { serverEnv: "STREAMABLE_HTTP_AUTH_TOKEN", agentEnv };

      expect(settingsIssues({ servers: [{ ...gitlab, bearerToken }] })).toEqual([
        { path: ["servers", 0, "bearerToken", "agentEnv"], message: RESERVED_ENV_MESSAGE },
      ]);
    },
  );

  it.each(["", "A=B", "1TOKEN", "HAS SPACE", "A\u0000B"])("rejects the agentEnv %j", (agentEnv) => {
    const bearerToken = { serverEnv: "STREAMABLE_HTTP_AUTH_TOKEN", agentEnv };

    expect(settingsIssues({ servers: [{ ...gitlab, bearerToken }] })).toEqual([
      { path: ["servers", 0, "bearerToken", "agentEnv"], message: ENV_NAME_MESSAGE },
    ]);
  });

  it("rejects a reserved serverEnv", () => {
    const bearerToken = { serverEnv: "PATH", agentEnv: "SHARED_MCP_TOKEN" };

    expect(settingsIssues({ servers: [{ ...gitlab, bearerToken }] })).toEqual([
      { path: ["servers", 0, "bearerToken", "serverEnv"], message: RESERVED_ENV_MESSAGE },
    ]);
  });
});
