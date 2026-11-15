import type { Task } from "../shared/contracts.js";

interface Row {
  id: string;
  label: string;
  description: string;
}

export type FieldItem =
  /** No tracker is connected yet; picking this opens the connection settings. */
  | ({ kind: "setup" } & Row)
  /** Undoes a pick. */
  | ({ kind: "none" } & Row)
  | ({ kind: "task" } & Task);

interface FieldInput {
  configured: boolean;
  tasks: readonly Task[];
  query: string;
  /** A task is already picked. */
  chosen: boolean;
}

/** What the Task field lists. */
export function fieldItems({ configured, tasks, query, chosen }: FieldInput): FieldItem[] {
  if (!configured) {
    return [
      {
        kind: "setup",
        id: "tasks:setup",
        label: "Connect Jira or GitLab",
        description: "Opens the task connections",
      },
    ];
  }
  const items: FieldItem[] = tasks.map((task) => ({ kind: "task", ...task }));
  // Only on the unfiltered list: while the user types, every row is a match.
  if (chosen && query.trim() === "") {
    items.unshift({
      kind: "none",
      id: "tasks:none",
      label: "No task",
      description: "Paseo names the branch",
    });
  }
  return items;
}
