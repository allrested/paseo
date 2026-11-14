import { defineAgentTool, type AgentToolDefinition } from "@getpaseo/plugin/server";
import { z } from "zod";
import type { DesignService } from "./design.js";

export const JoinInputSchema = z.object({
  file: z.string().min(1).optional(),
  name: z.string().min(1).max(80).optional(),
});

export const CompareInputSchema = z.object({
  file: z.string().min(1),
  frame: z.string().min(1),
  image: z.string().min(1),
});

export function designTools(
  service: Pick<DesignService, "join" | "compare">,
): AgentToolDefinition[] {
  return [
    defineAgentTool({
      name: "design_join",
      description:
        "Open a design in FigCraft for this workspace's project: pass file (an id from a Send to agent prompt or an earlier design_join) to open it, or name to start a new one. Returns how to join it with your FigCraft tools. The project's design/tokens.json is loaded as variables.",
      input: JoinInputSchema,
      execute: (input, { agent }) => service.join(agent, input),
    }),
    defineAgentTool({
      name: "design_compare",
      description:
        "Put a screenshot of the running app next to a design frame: file is the design's id, frame a layer id in it, image a PNG, JPEG or WebP path in this workspace (from android_screenshot or a Playwright screenshot). Places it right of the frame at the frame's width, for you and the user to compare.",
      input: CompareInputSchema,
      execute: (input, { agent }) => service.compare(agent, input),
    }),
  ];
}
