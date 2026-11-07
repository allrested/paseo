import { basename, isAbsolute, relative } from "node:path";
import { z } from "zod";
import { isInside, parseJson } from "./files.js";

export type AgentOutcome = "done" | "failed";

/** An agent of the run as the journal records it: its newest `started` line and its outcome. */
export interface JournalAgent {
  key: string;
  agentId: string;
  label: string;
  phase: string;
  outcome: AgentOutcome | null;
  /** The position of its newest `started` line among all of them, so agents list in start order. */
  order: number;
}

export interface JournalFold {
  /** The newest `started` per key. */
  agents: Map<string, JournalAgent>;
  /** How many `started` lines were folded. */
  starts: number;
}

export function newJournalFold(): JournalFold {
  return { agents: new Map(), starts: 0 };
}

const StartedSchema = z.object({
  type: z.literal("started"),
  key: z.string().min(1),
  agentId: z.string().min(1),
  label: z.string().optional().catch(undefined),
  phase: z.string().catch(""),
});

const OutcomeSchema = z.object({
  type: z.enum(["result", "failed"]),
  key: z.string().min(1),
  agentId: z.string().min(1),
});

const JournalEventSchema = z.union([StartedSchema, OutcomeSchema]);

/** Folds one journal line. `launched` lines, other types and garbled lines change nothing. */
export function foldJournalLine(fold: JournalFold, text: string): void {
  const parsed = JournalEventSchema.safeParse(parseJson(text));
  if (!parsed.success) return;
  const event = parsed.data;
  if (event.type === "started") {
    const label = event.label ?? event.key;
    fold.agents.set(event.key, {
      key: event.key,
      agentId: event.agentId,
      label,
      phase: event.phase,
      outcome: null,
      order: fold.starts,
    });
    fold.starts += 1;
    return;
  }
  const agent = fold.agents.get(event.key);
  // A rerun key's earlier attempt has another agentId; its outcome no longer counts.
  if (agent?.agentId !== event.agentId) return;
  agent.outcome = event.type === "result" ? "done" : "failed";
}

/** The run's agents in start order. */
export function journalAgents(fold: JournalFold): JournalAgent[] {
  const agents = [...fold.agents.values()];
  return agents.sort((a, b) => a.order - b.order);
}

/** The newest tool call of an agent. */
export interface LastToolUse {
  id: string;
  name: string;
  file: string | null;
  /** Its tool_result has arrived. */
  done: boolean;
}

export interface AgentFold {
  toolCalls: number;
  lastTool: LastToolUse | null;
  /** The newest nonzero context size: input, cache read, cache creation and output tokens. */
  tokens: number | null;
  /** Epoch milliseconds. */
  firstActivityAt: number | null;
  lastActivityAt: number | null;
}

export function newAgentFold(): AgentFold {
  return {
    toolCalls: 0,
    lastTool: null,
    tokens: null,
    firstActivityAt: null,
    lastActivityAt: null,
  };
}

// Claude Code writes compact JSON, so these bytes appear only as real keys and values: inside
// a string, as in a prompt that quotes them, the quotes are escaped.
const TOOL_USE_BYTES = '"type":"tool_use"';
const TOOL_RESULT_BYTES = '"type":"tool_result"';
const ASSISTANT_BYTES = '"type":"assistant"';
const USAGE_BYTES = '"usage"';

/** Whether an agent-file line can change the fold. Only these lines are parsed. */
export function isCandidateLine(text: string): boolean {
  const toolBlock = text.includes(TOOL_USE_BYTES) || text.includes(TOOL_RESULT_BYTES);
  const assistantUsage = text.includes(ASSISTANT_BYTES) && text.includes(USAGE_BYTES);
  return toolBlock || assistantUsage;
}

const UsageSchema = z.object({
  input_tokens: z.number().int().nonnegative(),
  output_tokens: z.number().int().nonnegative(),
  // A missing or null cache field counts as none.
  cache_read_input_tokens: z.number().int().nonnegative().catch(0),
  cache_creation_input_tokens: z.number().int().nonnegative().catch(0),
});

const AssistantLineSchema = z.object({
  type: z.literal("assistant"),
  timestamp: z.string().optional().catch(undefined),
  cwd: z.string().optional().catch(undefined),
  message: z.object({
    content: z.array(z.unknown()).catch([]),
    usage: UsageSchema.optional().catch(undefined),
  }),
});
type AssistantLine = z.output<typeof AssistantLineSchema>;

const UserLineSchema = z.object({
  type: z.literal("user"),
  timestamp: z.string().optional().catch(undefined),
  message: z.object({ content: z.array(z.unknown()).catch([]) }),
});
type UserLine = z.output<typeof UserLineSchema>;

const AgentLineSchema = z.union([AssistantLineSchema, UserLineSchema]);

const ToolUseBlockSchema = z.object({
  type: z.literal("tool_use"),
  id: z.string(),
  name: z.string(),
  input: z.unknown(),
});

const ToolResultBlockSchema = z.object({
  type: z.literal("tool_result"),
  tool_use_id: z.string(),
});

const FileInputSchema = z.object({ file_path: z.string().min(1) });

/** Folds one candidate line of an agent file. Lines of other shapes change nothing. */
export function foldAgentLine(fold: AgentFold, text: string): void {
  const parsed = AgentLineSchema.safeParse(parseJson(text));
  if (!parsed.success) return;
  const line = parsed.data;
  if (line.type === "assistant") {
    foldAssistant(fold, line);
    return;
  }
  foldUser(fold, line);
}

function foldAssistant(fold: AgentFold, line: AssistantLine): void {
  noteActivity(fold, line.timestamp);
  for (const block of line.message.content) {
    const toolUse = ToolUseBlockSchema.safeParse(block);
    if (!toolUse.success) continue;
    const { id, name, input } = toolUse.data;
    const file = displayFile(input, line.cwd);
    fold.toolCalls += 1;
    fold.lastTool = { id, name, file, done: false };
  }
  const { usage } = line.message;
  if (usage === undefined) return;
  const cached = usage.cache_read_input_tokens + usage.cache_creation_input_tokens;
  const total = usage.input_tokens + cached + usage.output_tokens;
  // Claude Code writes an API error as a synthetic message with all four counts at 0. A real
  // response always counts its input, so a zero total is no context size and keeps the last one.
  if (total === 0) return;
  fold.tokens = total;
}

function foldUser(fold: AgentFold, line: UserLine): void {
  noteActivity(fold, line.timestamp);
  const { lastTool } = fold;
  if (lastTool === null) return;
  for (const block of line.message.content) {
    const toolResult = ToolResultBlockSchema.safeParse(block);
    if (!toolResult.success) continue;
    if (toolResult.data.tool_use_id === lastTool.id) lastTool.done = true;
  }
}

function noteActivity(fold: AgentFold, timestamp: string | undefined): void {
  if (timestamp === undefined) return;
  const at = Date.parse(timestamp);
  if (Number.isNaN(at)) return;
  fold.firstActivityAt = Math.min(at, fold.firstActivityAt ?? at);
  fold.lastActivityAt = Math.max(at, fold.lastActivityAt ?? at);
}

/**
 * The file a tool works on, from its `input.file_path`: relative to the agent's cwd when inside
 * it, else its base name. Null when the input has no non-empty string `file_path`.
 */
export function displayFile(input: unknown, cwd: string | undefined): string | null {
  const parsed = FileInputSchema.safeParse(input);
  if (!parsed.success) return null;
  const path = parsed.data.file_path;
  if (cwd === undefined) return basename(path);
  if (!isAbsolute(path)) return basename(path);
  if (!isInside(cwd, path)) return basename(path);
  return relative(cwd, path);
}
