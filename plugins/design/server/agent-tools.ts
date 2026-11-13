import { defineAgentTool, type AgentToolDefinition } from "@getpaseo/plugin/server";
import { z } from "zod";
import type { DesignService } from "./design.js";

export const JoinInputSchema = z.object({
  file: z.string().min(1).optional(),
  name: z.string().min(1).max(80).optional(),
});

export function designTools(service: Pick<DesignService, "join">): AgentToolDefinition[] {
  return [
    defineAgentTool({
      name: "design_join",
      description:
        "Open a design in FigCraft for this workspace's project: pass file (an id from a Send to agent prompt or an earlier design_join) to open it, or name to start a new one. Returns how to join it with your FigCraft tools. The project's design/tokens.json is loaded as variables.",
      input: JoinInputSchema,
      execute: (input, { agent }) => service.join(agent, input),
    }),
  ];
}
