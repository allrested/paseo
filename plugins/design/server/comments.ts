export interface CommentPorts {
  openThreads(fileId: string): Promise<{ id: string }[]>;
  prompt(fileId: string, ids: string[]): Promise<string>;
  agentOf(fileId: string): Promise<string | null>;
  agentIdle(agentId: string): Promise<boolean>;
  send(agentId: string, text: string): Promise<void>;
  log(line: string): void;
}

export interface CommentRouter {
  poll(fileId: string): Promise<void>;
  turnEnded(agentId: string): Promise<void>;
  forget(fileId: string): void;
}

export function createCommentRouter(ports: CommentPorts): CommentRouter {
  const sentIds = new Map<string, Set<string>>();
  const waiting = new Map<string, string[]>();
  /** Agents that got a prompt in their current turn. */
  const prompted = new Set<string>();

  async function deliver(fileId: string, agentId: string): Promise<void> {
    const ids = waiting.get(fileId) ?? [];
    if (ids.length === 0 || prompted.has(agentId)) return;
    try {
      const text = await ports.prompt(fileId, ids);
      await ports.send(agentId, text);
      const sent = sentIds.get(fileId) ?? new Set<string>();
      for (const id of ids) sent.add(id);
      sentIds.set(fileId, sent);
      waiting.set(fileId, []);
      prompted.add(agentId);
    } catch (error) {
      ports.log(`[design] comments for ${fileId} not sent: ${(error as Error).message}`);
    }
  }

  return {
    async poll(fileId) {
      // Rebuilt from the open threads each time, so one resolved while it waited never goes out.
      const sent = sentIds.get(fileId) ?? new Set<string>();
      const open = await ports.openThreads(fileId);
      waiting.set(
        fileId,
        open.flatMap((thread) => (sent.has(thread.id) ? [] : [thread.id])),
      );
      const agentId = await ports.agentOf(fileId);
      if (agentId === null || prompted.has(agentId)) return;
      if (await ports.agentIdle(agentId)) await deliver(fileId, agentId);
    },
    async turnEnded(agentId) {
      prompted.delete(agentId);
      for (const fileId of waiting.keys()) {
        if ((await ports.agentOf(fileId)) === agentId) await deliver(fileId, agentId);
      }
    },
    forget(fileId) {
      waiting.delete(fileId);
      sentIds.delete(fileId);
    },
  };
}
