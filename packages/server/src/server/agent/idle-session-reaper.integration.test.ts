/**
 * The reaper against a real AgentManager.
 *
 * idle-session-reaper.test.ts covers the policy in isolation. This exercises
 * the sweep itself: that it reads live agents, honours the guards against a
 * real manager's state, actually closes the session, and unregisters the agent
 * so the process is reclaimed.
 */
import { expect, test, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

import { createTestLogger } from "../../test-utils/test-logger.js";
import { AgentManager } from "./agent-manager.js";
import type {
  AgentClient,
  AgentPersistenceHandle,
  AgentRunResult,
  AgentSession,
  AgentSessionConfig,
  AgentStreamEvent,
} from "./agent-sdk-types.js";

const logger = createTestLogger();

const RESUMABLE_CAPABILITIES = {
  supportsStreaming: false,
  // The two the reaper's guard requires.
  supportsSessionPersistence: true,
  supportsSessionListing: true,
  supportsDynamicModes: false,
  supportsMcpServers: false,
  supportsReasoningStream: false,
  supportsToolInvocations: false,
} as const;

/** Minimal session that records whether the manager closed it. */
class ReapableSession implements AgentSession {
  readonly provider = "codex" as const;
  readonly capabilities = RESUMABLE_CAPABILITIES;
  readonly id = randomUUID();
  closeCount = 0;
  private subscribers = new Set<(event: AgentStreamEvent) => void>();

  constructor(
    private readonly config: AgentSessionConfig,
    private readonly persistence: AgentPersistenceHandle | null,
  ) {}

  async run(): Promise<AgentRunResult> {
    return { sessionId: this.id, finalText: "", timeline: [] };
  }

  async startTurn(): Promise<{ turnId: string }> {
    return { turnId: "turn-1" };
  }

  subscribe(callback: (event: AgentStreamEvent) => void): () => void {
    this.subscribers.add(callback);
    return () => this.subscribers.delete(callback);
  }

  describePersistence(): AgentPersistenceHandle | null {
    return this.persistence;
  }

  async close(): Promise<void> {
    this.closeCount += 1;
  }
}

class ReapableClient implements AgentClient {
  readonly provider = "codex" as const;
  readonly capabilities = RESUMABLE_CAPABILITIES;
  readonly sessions: ReapableSession[] = [];

  constructor(private readonly persistence: AgentPersistenceHandle | null) {}

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async createSession(config: AgentSessionConfig): Promise<AgentSession> {
    const session = new ReapableSession(config, this.persistence);
    this.sessions.push(session);
    return session;
  }
}

function handle(): AgentPersistenceHandle {
  return { provider: "codex", sessionId: randomUUID() };
}

async function makeAgent(persistence: AgentPersistenceHandle | null) {
  const cwd = mkdtempSync(join(tmpdir(), "idle-reaper-"));
  const client = new ReapableClient(persistence);
  const manager = new AgentManager({
    clients: { codex: client as unknown as AgentClient },
    logger,
  });
  const agent = await manager.createAgent({ provider: "codex", cwd }, undefined, {
    workspaceId: undefined,
  });
  return { manager, client, agent };
}

/** Far enough ahead that any real threshold has elapsed. */
function wellPast(): Date {
  return new Date(Date.now() + 24 * 60 * 60_000);
}

test("a sweep closes an idle session and unregisters the agent", async () => {
  const { manager, client, agent } = await makeAgent(handle());
  manager.startIdleSessionReaper({ enabled: true, idleMs: 60_000, sweepMs: 30_000 });

  const reaped = await manager.reapIdleSessions(wellPast());

  expect(reaped).toEqual([agent.id]);
  // The whole point: the provider process is released.
  expect(client.sessions[0]?.closeCount).toBe(1);
  // And the agent is gone from the live registry, so the next sweep is a no-op.
  expect(manager.getAgent(agent.id)).toBeNull();
  manager.stopIdleSessionReaper();
});

test("a sweep is a no-op while the reaper is unconfigured", async () => {
  const { manager, client, agent } = await makeAgent(handle());
  // No startIdleSessionReaper call at all.
  const reaped = await manager.reapIdleSessions(wellPast());

  expect(reaped).toEqual([]);
  expect(client.sessions[0]?.closeCount).toBe(0);
  expect(manager.getAgent(agent.id)).toBeDefined();
});

test("a provider with no persistence handle is never reaped", async () => {
  // describePersistence() returns null, so resume would fall back to
  // createAgent and silently lose the conversation.
  const { manager, client, agent } = await makeAgent(null);
  manager.startIdleSessionReaper({ enabled: true, idleMs: 60_000, sweepMs: 30_000 });

  const reaped = await manager.reapIdleSessions(wellPast());

  expect(reaped).toEqual([]);
  expect(client.sessions[0]?.closeCount).toBe(0);
  expect(manager.getAgent(agent.id)).toBeDefined();
  manager.stopIdleSessionReaper();
});

test("an agent younger than the threshold survives the sweep", async () => {
  const { manager, client } = await makeAgent(handle());
  manager.startIdleSessionReaper({ enabled: true, idleMs: 60 * 60_000, sweepMs: 30_000 });

  // "now" is now: the agent was created moments ago.
  const reaped = await manager.reapIdleSessions(new Date());

  expect(reaped).toEqual([]);
  expect(client.sessions[0]?.closeCount).toBe(0);
  manager.stopIdleSessionReaper();
});

test("a failing close leaves the agent alone rather than aborting the sweep", async () => {
  const { manager, client } = await makeAgent(handle());
  manager.startIdleSessionReaper({ enabled: true, idleMs: 60_000, sweepMs: 30_000 });
  vi.spyOn(client.sessions[0]!, "close").mockRejectedValue(new Error("provider wedged"));

  // Must not throw: one bad close cannot stop the sweep or crash the daemon.
  const reaped = await manager.reapIdleSessions(wellPast());

  expect(reaped).toEqual([]);
  manager.stopIdleSessionReaper();
});

test("stopping the reaper disables further sweeps", async () => {
  const { manager, client } = await makeAgent(handle());
  manager.startIdleSessionReaper({ enabled: true, idleMs: 60_000, sweepMs: 30_000 });
  manager.stopIdleSessionReaper();
  manager.prepareForShutdown();

  const reaped = await manager.reapIdleSessions(wellPast());

  expect(reaped).toEqual([]);
  expect(client.sessions[0]?.closeCount).toBe(0);
});
