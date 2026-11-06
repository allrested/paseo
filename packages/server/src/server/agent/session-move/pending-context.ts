import { z } from "zod";
import type { AgentPromptContentBlock, AgentPromptInput } from "../agent-sdk-types.js";
import type { AgentStorage } from "../agent-storage.js";

export const PendingMoveContextSchema = z.object({ text: z.string(), title: z.string() });

export const MoveHistorySegmentSchema = z.object({
  // The agent that held the session for this stretch.
  agentId: z.string(),
  // Its provider label at the hop, e.g. "Claude (work)".
  label: z.string(),
  // Curated fork entries of its own rows; empty when it never ran.
  entries: z.array(z.string()),
  // Edit/write paths in those rows.
  files: z.array(z.string()),
  // Open items of its latest todo row; null when it has no todo row.
  openTodos: z.array(z.string()).nullable(),
  lastError: z.string().nullable(),
});

export const MoveHistorySchema = z.object({
  // The session's first typed task, set once at the root and copied forward.
  originalTask: z.string().nullable(),
  // This agent's own rows are the ones after this seq.
  sinceSeq: z.number().int().nonnegative(),
  // Every tenure the session has left, oldest first.
  segments: z.array(MoveHistorySegmentSchema),
});

export type PendingMoveContext = z.infer<typeof PendingMoveContextSchema>;
export type MoveHistory = z.infer<typeof MoveHistorySchema>;
export type MoveHistorySegment = z.infer<typeof MoveHistorySegmentSchema>;
export type MoveChain = Omit<MoveHistory, "sinceSeq">;

export function withPendingMoveContext(
  prompt: AgentPromptInput,
  context: PendingMoveContext,
): AgentPromptInput {
  const history: AgentPromptContentBlock = {
    type: "text",
    mimeType: "text/plain",
    contextKind: "chat_history",
    title: context.title,
    text: context.text,
  };
  const blocks: AgentPromptContentBlock[] =
    typeof prompt === "string" ? [{ type: "text", text: prompt }] : prompt;
  return [history, ...blocks];
}

/**
 * Prepends the history a move left for this agent, taking it from storage. At most once: it is
 * cleared before the run starts, because a turn that fails after dispatch may already be stored
 * by the provider. Nothing is lost, since `moveHistory` keeps the work for the next move.
 */
export async function takePendingMovePrompt(input: {
  agentStorage: Pick<AgentStorage, "takePendingMoveContext">;
  agentId: string;
  prompt: AgentPromptInput;
}): Promise<AgentPromptInput> {
  const pending = await input.agentStorage.takePendingMoveContext(input.agentId);
  return pending ? withPendingMoveContext(input.prompt, pending) : input.prompt;
}
