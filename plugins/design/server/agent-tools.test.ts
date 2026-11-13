import { describe, expect, it } from "vitest";
import { designTools } from "./agent-tools.js";

describe("design_join", () => {
  it("is one tool that passes the agent and input to the service", async () => {
    const calls: unknown[] = [];
    const [tool] = designTools({
      join: async (agent: unknown, input: unknown) => (calls.push([agent, input]), { text: "ok" }),
    } as never);
    expect(tool.name).toBe("design_join");
    const agent = { id: "a1", workspaceId: "w1" };
    expect(await tool.execute({ name: "Card" }, { agent } as never)).toEqual({ text: "ok" });
    expect(calls).toEqual([[agent, { name: "Card" }]]);
  });
});
