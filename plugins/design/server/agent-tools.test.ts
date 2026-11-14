import { describe, expect, it } from "vitest";
import { designTools } from "./agent-tools.js";

describe("design tools", () => {
  it("design_compare passes the agent and input to the service", async () => {
    const calls: unknown[] = [];
    const [, tool] = designTools({
      compare: async (agent: unknown, input: unknown) => (
        calls.push([agent, input]), { text: "ok" }
      ),
    } as never);
    expect(tool.name).toBe("design_compare");
    const agent = { id: "a1", workspaceId: "w1" };
    const input = { file: "f1", frame: "4294967297", image: ".paseo/android/shot.png" };
    expect(await tool.execute(input, { agent } as never)).toEqual({ text: "ok" });
    expect(calls).toEqual([[agent, input]]);
  });
  it("design_join passes the agent and input to the service", async () => {
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
