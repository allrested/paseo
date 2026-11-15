import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useRpc } from "@getpaseo/plugin/client";
import {
  addCommentRpc,
  changeStatusRpc,
  listTasksRpc,
  taskDetailRpc,
  type TaskDetail,
  type TaskList,
  type TaskRow,
} from "../shared/contracts.js";
import { reason } from "./reason.js";

export interface Loaded<Value> {
  /** The last good answer; null before the first. */
  value: Value | null;
  /** A read is on its way. */
  loading: boolean;
  /** Why the newest read failed; the value, if any, is from before it. */
  error: string | null;
}

// On a phone the list and a task's page are two routes, and going back mounts the list again.
// The last answers are kept so it shows at once and then refreshes.
const LISTS_KEPT = 8;
const DETAILS_KEPT = 30;
const lists = new Map<string, TaskList>();
const details = new Map<string, TaskDetail>();

function keep<Value>(kept: Map<string, Value>, key: string, value: Value, max: number): void {
  kept.delete(key);
  kept.set(key, value);
  for (const oldest of kept.keys()) {
    if (kept.size <= max) break;
    kept.delete(oldest);
  }
}

// A move or a comment on a task's page changes its row. The lists that are kept, and the one
// on screen beside the page, take the row from the page's answer: the trackers are not asked
// again, and a task moved to a done status stays in view until the list is refreshed.
let rowChanges = 0;
const rowListeners = new Set<() => void>();

function subscribeRows(listener: () => void): () => void {
  rowListeners.add(listener);
  return () => void rowListeners.delete(listener);
}

function rowChanged(id: string, task: TaskDetail): void {
  const follow = (row: TaskRow): TaskRow => {
    if (row.id !== id) return row;
    const { updatedAt: _before, ...rest } = row;
    return {
      ...rest,
      title: task.title,
      status: task.status,
      ...(task.updatedAt === undefined ? {} : { updatedAt: task.updatedAt }),
    };
  };
  for (const [query, list] of lists) {
    lists.set(query, {
      ...list,
      issues: list.issues.map(follow),
      mergeRequests: list.mergeRequests.map(follow),
    });
  }
  rowChanges += 1;
  for (const listener of rowListeners) listener();
}

/** For tests: what one test read must not show in the next. */
export function forgetTasks(): void {
  lists.clear();
  details.clear();
}

export interface TaskListState extends Loaded<TaskList> {
  reload(): void;
}

/** The signed-in user's issues and merge requests that match `query`. */
export function useTaskList(query: string): TaskListState {
  const list = useRpc(listTasksRpc);
  const [state, setState] = useState<Loaded<TaskList>>(() => ({
    value: lists.get(query) ?? null,
    loading: true,
    error: null,
  }));
  const [turn, setTurn] = useState(0);
  useEffect(() => {
    let current = true;
    // The rows of the query before stay up while this one loads, so the list does not blink.
    setState((before) => ({
      value: lists.get(query) ?? before.value,
      loading: true,
      error: null,
    }));
    list({ query }).then(
      (value) => {
        keep(lists, query, value, LISTS_KEPT);
        if (current) setState({ value, loading: false, error: null });
        return undefined;
      },
      (error: unknown) => {
        if (current) setState((before) => ({ ...before, loading: false, error: reason(error) }));
      },
    );
    return () => {
      current = false;
    };
  }, [list, query, turn]);
  const reload = useCallback(() => setTurn((count) => count + 1), []);
  const changes = useSyncExternalStore(
    subscribeRows,
    () => rowChanges,
    () => rowChanges,
  );
  useEffect(() => {
    if (changes === 0) return;
    setState((before) => ({ ...before, value: lists.get(query) ?? before.value }));
  }, [changes, query]);
  return { ...state, reload };
}

export interface TaskDetailState extends Loaded<TaskDetail> {
  reload(): void;
  /** Posts a comment; rejects with the reason in words. */
  comment(text: string): Promise<void>;
  /** Moves the task by one of its `changes`; rejects with the reason in words. */
  change(change: string): Promise<void>;
}

/** One task's page, and the two things that change the task. */
export function useTaskDetail(id: string): TaskDetailState {
  const read = useRpc(taskDetailRpc);
  const addComment = useRpc(addCommentRpc);
  const changeStatus = useRpc(changeStatusRpc);
  const [state, setState] = useState<Loaded<TaskDetail>>(() => ({
    value: details.get(id) ?? null,
    loading: true,
    error: null,
  }));
  const [turn, setTurn] = useState(0);
  // The task on screen: an answer for another one, come late, is kept for later and not shown.
  // It is told by the id that was asked for: the tracker may answer under another (a moved issue).
  const shown = useRef(id);
  useEffect(() => {
    shown.current = id;
  }, [id]);
  const show = useCallback((asked: string, value: TaskDetail) => {
    keep(details, asked, value, DETAILS_KEPT);
    if (shown.current === asked) setState({ value, loading: false, error: null });
  }, []);
  useEffect(() => {
    let current = true;
    setState({ value: details.get(id) ?? null, loading: true, error: null });
    read({ id }).then(
      (value) => {
        if (current) show(id, value);
        return undefined;
      },
      (error: unknown) => {
        if (current) setState((before) => ({ ...before, loading: false, error: reason(error) }));
      },
    );
    return () => {
      current = false;
    };
  }, [read, id, turn, show]);
  const reload = useCallback(() => setTurn((count) => count + 1), []);
  const comment = useCallback(
    async (text: string) => {
      const value = await addComment({ id, text }).catch((error: unknown) => {
        throw new Error(reason(error));
      });
      show(id, value);
      rowChanged(id, value);
    },
    [addComment, id, show],
  );
  const change = useCallback(
    async (changeId: string) => {
      const value = await changeStatus({ id, change: changeId }).catch((error: unknown) => {
        throw new Error(reason(error));
      });
      show(id, value);
      rowChanged(id, value);
    },
    [changeStatus, id, show],
  );
  return { ...state, reload, comment, change };
}
