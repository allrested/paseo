import type { PluginClientContext } from "@getpaseo/plugin/client";
import { WORKFLOW_ITEM_KIND, WORKFLOW_ITEM_VERSION, WorkflowItemSchema } from "./shared/run.js";
import { WorkflowCard } from "./client/card.js";
import { transformWorkflowCall } from "./client/transform.js";

export default function contribute(client: PluginClientContext) {
  const removers = [
    client.addTimelineTransformer<"tool_call">({
      id: "workflow-card",
      query: { itemType: "tool_call" },
      transform: transformWorkflowCall,
    }),
    client.addTimelineRenderer({
      kind: WORKFLOW_ITEM_KIND,
      version: WORKFLOW_ITEM_VERSION,
      schema: WorkflowItemSchema,
      Component: WorkflowCard,
    }),
  ];
  return () => {
    for (const remove of removers) remove();
  };
}
