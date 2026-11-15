import type { Author } from "../shared/contracts.js";
import { errorMessage } from "./errors.js";
import type { RecordInput } from "./record.js";
import type { Shadow } from "./shadow.js";
import type { WorkTree } from "./work-tree.js";

/** The agent of a turn, as the hooks name it. */
export interface TurnAgent {
  id: string;
  parentAgentId: string | null;
  /** A helper: its edits are part of its parent's turn. */
  background: boolean;
  cwd: string;
  title: string | null;
  provider: string;
  workspaceId: string | null;
}

export interface TrackerPorts {
  findWorkTree(folder: string): Promise<WorkTree | null>;
  openShadow(top: string): Promise<Shadow>;
  snapshot(workTree: WorkTree, shadow: Shadow): Promise<string>;
  /** Answers how many files were recorded. */
  record(input: RecordInput): Promise<number>;
  /** Now, in milliseconds. */
  now(): number;
  log(message: string): void;
  /** A change was recorded for agents of these workspaces. */
  changed(workspaceIds: string[]): void;
}

export interface Tracker {
  /** A turn started. Resolves when the folder's snapshot is taken. */
  started(agent: TurnAgent): Promise<void>;
  /** A turn ended. Resolves when its change is recorded. */
  ended(agentId: string): Promise<void>;
  /** The agent was closed or archived: a turn it had under way is over. */
  gone(agentId: string): Promise<void>;
}

interface Owner {
  author: Author;
  workspaceId: string | null;
  /** The agents whose running turns count for this owner: itself, and its helpers. */
  turns: Set<string>;
}

interface Folder {
  workTree: WorkTree;
  shadow: Shadow;
  /** The agents with a turn under way here, by the agent the lines are credited to. */
  owners: Map<string, Owner>;
  /** The last snapshot, while an agent runs. */
  open: string | null;
  /** One step at a time: a snapshot and its record belong together. */
  queue: Promise<void>;
}

type Step =
  | { kind: "start"; agent: TurnAgent; ownerId: string }
  | { kind: "end"; agentId: string; ownerId: string };

interface Planned {
  folder: Folder;
  step: Step;
}

export function createTracker(ports: TrackerPorts): Tracker {
  const folders = new Map<string, Folder>();
  /** Where each agent's running turn was started, and whom it counts for. */
  const places = new Map<string, { folder: Folder; ownerId: string }>();
  // Finding the folder is quick and runs in the order the hooks fired, so a turn's end never
  // overtakes its start. The slow part then waits in its own folder's queue.
  let lookups: Promise<unknown> = Promise.resolve();

  async function folderOf(agent: TurnAgent): Promise<Folder | null> {
    const workTree = await ports.findWorkTree(agent.cwd);
    if (!workTree) return null;
    const known = folders.get(workTree.top);
    if (known) return known;
    const folder: Folder = {
      workTree,
      shadow: await ports.openShadow(workTree.top),
      owners: new Map(),
      open: null,
      queue: Promise.resolve(),
    };
    folders.set(workTree.top, folder);
    return folder;
  }

  /** The end of the agent's running turn, when it has one. */
  function leave(agentId: string): Planned[] {
    const place = places.get(agentId);
    if (!place) return [];
    places.delete(agentId);
    return [{ folder: place.folder, step: { kind: "end", agentId, ownerId: place.ownerId } }];
  }

  async function enter(agent: TurnAgent): Promise<Planned[]> {
    const folder = await folderOf(agent);
    // A start without the end before it: the daemon missed one, or the agent moved folders.
    const planned = places.get(agent.id)?.folder === folder ? [] : leave(agent.id);
    if (!folder) return planned;
    const ownerId = agent.background && agent.parentAgentId ? agent.parentAgentId : agent.id;
    places.set(agent.id, { folder, ownerId });
    return [...planned, { folder, step: { kind: "start", agent, ownerId } }];
  }

  function apply(folder: Folder, step: Step): void {
    const known = folder.owners.get(step.ownerId);
    if (step.kind === "end") {
      known?.turns.delete(step.agentId);
      if (known?.turns.size === 0) folder.owners.delete(step.ownerId);
      return;
    }
    const { agent, ownerId } = step;
    const own = ownerId === agent.id;
    const owner = known ?? {
      // A helper whose parent is not running here still credits the parent; the panel knows
      // the parent's title.
      author: { id: ownerId, title: own ? agent.title : null, provider: agent.provider },
      workspaceId: agent.workspaceId,
      turns: new Set<string>(),
    };
    if (own) owner.author = { id: ownerId, title: agent.title, provider: agent.provider };
    owner.turns.add(agent.id);
    folder.owners.set(ownerId, owner);
  }

  async function run(folder: Folder, step: Step): Promise<void> {
    const running = Array.from(folder.owners.values());
    let tree: string | null = null;
    try {
      tree = await ports.snapshot(folder.workTree, folder.shadow);
    } catch (error) {
      ports.log(`[attribution] no snapshot of ${folder.workTree.top}: ${errorMessage(error)}`);
    }
    if (tree !== null && folder.open !== null && running.length > 0 && tree !== folder.open) {
      try {
        const files = await ports.record({
          shadow: folder.shadow,
          workTree: folder.workTree,
          before: folder.open,
          after: tree,
          authors: running.map((owner) => owner.author),
          at: ports.now(),
        });
        if (files > 0) {
          const ids = running.flatMap((owner) => (owner.workspaceId ? [owner.workspaceId] : []));
          ports.changed(Array.from(new Set(ids)));
        }
      } catch (error) {
        ports.log(
          `[attribution] change in ${folder.workTree.top} not recorded: ${errorMessage(error)}`,
        );
      }
    }
    apply(folder, step);
    // With nobody running, what changes next is not an agent's: the next start looks afresh.
    folder.open = folder.owners.size > 0 ? tree : null;
  }

  async function enqueue(plan: () => Promise<Planned[]> | Planned[]): Promise<void> {
    const planned = lookups.then(plan);
    lookups = planned.catch(() => undefined);
    let steps: Planned[];
    try {
      steps = await planned;
    } catch (error) {
      ports.log(`[attribution] folder not found: ${errorMessage(error)}`);
      return;
    }
    await Promise.all(
      steps.map(({ folder, step }) => {
        // A step that fails must not stop the folder's later ones.
        folder.queue = folder.queue
          .then(() => run(folder, step))
          .catch((error) => ports.log(`[attribution] step failed: ${errorMessage(error)}`));
        return folder.queue;
      }),
    );
  }

  return {
    started: (agent) => enqueue(() => enter(agent)),
    ended: (agentId) => enqueue(() => leave(agentId)),
    gone: (agentId) => enqueue(() => leave(agentId)),
  };
}
