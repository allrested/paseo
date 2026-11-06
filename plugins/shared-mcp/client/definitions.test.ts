import { describe, expect, it } from "vitest";
import { formatDefinitions, parseDefinitions, withServerEnabled } from "./definitions.js";

const context7 = {
  id: "context7",
  label: "Context7",
  command: "npx -y @upstash/context7-mcp@4.0.4 --transport http --port 8932",
  port: 8932,
};
const context7Saved = { ...context7, env: {}, healthPath: "/mcp", requires: [], enabled: true };
const gitlabSaved = {
  id: "gitlab",
  label: "GitLab",
  command: "npx -y @zereight/mcp-gitlab@2.1.52",
  env: { STREAMABLE_HTTP: "true" },
  port: 8933,
  healthPath: "/mcp",
  requires: [],
  bearerToken: { serverEnv: "STREAMABLE_HTTP_AUTH_TOKEN", agentEnv: "SHARED_MCP_TOKEN" },
  enabled: true,
};

describe("parseDefinitions", () => {
  it("returns the settings document with schema defaults filled and no undefined keys", () => {
    expect(parseDefinitions(JSON.stringify([context7]))).toStrictEqual({
      ok: true,
      values: { servers: [context7Saved] },
    });
  });

  it("reports malformed JSON", () => {
    expect(parseDefinitions("[{")).toStrictEqual({
      ok: false,
      error: expect.stringMatching(/^Invalid JSON: /),
    });
  });

  it("names the full path of a schema issue", () => {
    expect(parseDefinitions(JSON.stringify([{ ...context7, port: 0 }]))).toStrictEqual({
      ok: false,
      error: "servers.0.port: Too small: expected number to be >=1",
    });
  });

  it("rejects a document that is not an array", () => {
    expect(parseDefinitions("{}")).toStrictEqual({
      ok: false,
      error: "servers: Invalid input: expected array, received object",
    });
  });

  it("runs the document-level duplicate check before save", () => {
    // ServerDefinitionSchema accepts each entry; only the settings superRefine rejects the pair.
    const twin = { ...context7, id: "context7-copy" };
    expect(parseDefinitions(JSON.stringify([context7, twin]))).toStrictEqual({
      ok: false,
      error: 'servers.1.port: Port 8932 is used by both "context7" and "context7-copy"',
    });
  });
});

describe("formatDefinitions", () => {
  it("round-trips through parseDefinitions", () => {
    const servers = [context7Saved, gitlabSaved];
    expect(parseDefinitions(formatDefinitions(servers))).toStrictEqual({
      ok: true,
      values: { servers },
    });
  });
});

describe("withServerEnabled", () => {
  it("changes only the named server and leaves the input untouched", () => {
    const servers = [context7Saved, gitlabSaved];
    expect(withServerEnabled(servers, "gitlab", false)).toStrictEqual([
      context7Saved,
      { ...gitlabSaved, enabled: false },
    ]);
    expect(servers[1]?.enabled).toBe(true);
  });

  it("throws for an id that is not defined", () => {
    expect(() => withServerEnabled([context7Saved], "playwright", true)).toThrow(
      "Unknown server: playwright",
    );
  });
});
