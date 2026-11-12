import {
  BOARD_POST_MAX,
  DONE_TASK_TTL_MS,
  POST_TEXT_MAX,
  READ_POST_MAX,
  type DeleteResult,
  type Post,
  type PostKind,
  type PostResult,
  type UpdateAction,
} from "../shared/contracts.js";
import type { BoardStore, BoardsFile } from "./board-store.js";
import { errorMessage } from "./errors.js";
import type { Clock } from "./timers.js";

export interface NewPost {
  board: string;
  kind: PostKind;
  text: string;
  to?: string;
  /** An agent id, or "user". */
  author: string;
}

export interface PostUpdate {
  id: string;
  action: UpdateAction;
  actor: string;
}

export interface ReadResult {
  posts: Post[];
  /** The highest seq returned; pass it as `since` for newer posts only. */
  cursor: number;
  /** More posts after `cursor` than one read returns. */
  more: boolean;
}

export interface BoardServicePorts {
  store: BoardStore;
  clock: Clock;
  log(message: string): void;
  /** A readable name for an agent id or "user". */
  label(author: string): string;
  onBoard(board: string, posts: readonly Post[]): void;
  onBoardRemoved(board: string): void;
}

export interface BoardService {
  start(): Promise<void>;
  boards(): Record<string, Post[]>;
  wakesPaused(): boolean;
  post(input: NewPost): Promise<PostResult>;
  update(input: PostUpdate): Promise<PostResult>;
  remove(id: string): Promise<DeleteResult>;
  read(board: string, since: number | null): ReadResult;
  removeBoard(board: string): Promise<void>;
  setWakesPaused(paused: boolean): Promise<void>;
  prune(): Promise<void>;
}

type Outcome<T> = { ok: true; value: T } | { ok: false; error: string };

const VERBS: Record<UpdateAction, string> = { claim: "claim", done: "finish", reopen: "reopen" };

function byAge(left: Post, right: Post): number {
  return left.createdAt.localeCompare(right.createdAt) || left.seq - right.seq;
}

/** Drops the oldest done tasks, then the oldest notes, until `max` posts are left or none can go. */
export function trimBoard(posts: readonly Post[], max: number): Post[] {
  if (posts.length <= max) return [...posts];
  const done = posts.filter((item) => item.kind === "task" && item.state === "done").sort(byAge);
  const notes = posts.filter((item) => item.kind === "note").sort(byAge);
  const drop = new Set([...done, ...notes].slice(0, posts.length - max).map((item) => item.id));
  return posts.filter((item) => !drop.has(item.id));
}

function withoutClaim(post: Post): Post {
  const next: Post = {
    id: post.id,
    seq: post.seq,
    board: post.board,
    kind: post.kind,
    text: post.text,
    author: post.author,
    createdAt: post.createdAt,
    updatedAt: post.updatedAt,
  };
  if (post.to !== undefined) next.to = post.to;
  if (post.state !== undefined) next.state = post.state;
  return next;
}

export function createBoardService(ports: BoardServicePorts): BoardService {
  let data: BoardsFile = { version: 1, nextSeq: 1, wakesPaused: false, posts: [] };
  let chain: Promise<unknown> = Promise.resolve();

  function exclusive<T>(work: () => Promise<T>): Promise<T> {
    const run = chain.then(work);
    chain = run.catch(() => undefined);
    return run;
  }

  function postsOf(board: string): Post[] {
    return data.posts
      .filter((item) => item.board === board)
      .sort((left, right) => left.seq - right.seq);
  }

  function now(): string {
    return new Date(ports.clock.now()).toISOString();
  }

  /** A listener that throws is logged: the change is saved and stands. */
  function tell(listener: () => void): void {
    try {
      listener();
    } catch (error) {
      ports.log(`[office] board listener failed: ${errorMessage(error)}`);
    }
  }

  /** Saves `next`, then makes it current and announces the touched boards. */
  async function commit(next: BoardsFile, touched: readonly string[]): Promise<Outcome<null>> {
    try {
      await ports.store.save(next);
    } catch (error) {
      ports.log(`[office] unable to save the board: ${errorMessage(error)}`);
      return { ok: false, error: `Unable to save the board: ${errorMessage(error)}` };
    }
    data = next;
    for (const board of new Set(touched)) tell(() => ports.onBoard(board, postsOf(board)));
    return { ok: true, value: null };
  }

  function validText(text: string): Outcome<string> {
    const trimmed = text.trim();
    if (trimmed.length === 0) return { ok: false, error: "Unable to post: the text is empty" };
    if (trimmed.length > POST_TEXT_MAX) {
      return { ok: false, error: "Unable to post: the text is longer than 2,000 characters" };
    }
    return { ok: true, value: trimmed };
  }

  async function createPost(input: NewPost): Promise<PostResult> {
    const text = validText(input.text);
    if (!text.ok) return text;
    const seq = data.nextSeq;
    const stamp = now();
    const created: Post = {
      id: `p${seq}`,
      seq,
      board: input.board,
      kind: input.kind,
      text: text.value,
      author: input.author,
      createdAt: stamp,
      updatedAt: stamp,
    };
    if (input.to !== undefined) created.to = input.to;
    if (input.kind === "task") created.state = "open";
    // Make room among the existing posts, so the new one is never the one dropped.
    const kept = trimBoard(postsOf(input.board), BOARD_POST_MAX - 1);
    if (kept.length >= BOARD_POST_MAX) {
      return { ok: false, error: "Unable to post: the board holds 200 open or claimed tasks" };
    }
    const others = data.posts.filter((item) => item.board !== input.board);
    const posts = [...others, ...kept, created];
    const saved = await commit({ ...data, nextSeq: seq + 1, posts }, [input.board]);
    return saved.ok ? { ok: true, post: created } : saved;
  }

  function nextState(post: Post, input: PostUpdate): Outcome<Post | null> {
    const refuse = (reason: string): Outcome<Post | null> => ({
      ok: false,
      error: `Unable to ${VERBS[input.action]} ${post.id}: ${reason}`,
    });
    if (post.kind !== "task") return refuse("it is a note");
    if (input.action === "claim") {
      if (post.state === "done") return refuse("it is done");
      if (post.state === "claimed" && post.claimedBy === input.actor)
        return { ok: true, value: null };
      if (post.state === "claimed" && post.claimedBy !== undefined) {
        return refuse(`claimed by ${ports.label(post.claimedBy)}`);
      }
      return { ok: true, value: { ...post, state: "claimed", claimedBy: input.actor } };
    }
    if (input.action === "done") {
      return post.state === "done"
        ? { ok: true, value: null }
        : { ok: true, value: { ...post, state: "done" } };
    }
    // Like a repeated claim: an open task that nobody holds is not changed by a reopen.
    if (post.state === "open" && post.claimedBy === undefined) return { ok: true, value: null };
    return { ok: true, value: { ...withoutClaim(post), state: "open" } };
  }

  async function updatePost(input: PostUpdate): Promise<PostResult> {
    const post = data.posts.find((item) => item.id === input.id);
    if (!post) return { ok: false, error: `Unable to update ${input.id}: no such post` };
    const next = nextState(post, input);
    if (!next.ok) return next;
    if (next.value === null) return { ok: true, post };
    const changed: Post = { ...next.value, seq: data.nextSeq, updatedAt: now() };
    const posts = data.posts.map((item) => (item.id === post.id ? changed : item));
    const saved = await commit({ ...data, nextSeq: data.nextSeq + 1, posts }, [post.board]);
    return saved.ok ? { ok: true, post: changed } : saved;
  }

  async function prunePosts(): Promise<void> {
    const cutoff = ports.clock.now() - DONE_TASK_TTL_MS;
    const expired = data.posts.filter(
      (item) =>
        item.kind === "task" && item.state === "done" && Date.parse(item.updatedAt) < cutoff,
    );
    if (expired.length === 0) return;
    const gone = new Set(expired.map((item) => item.id));
    const boards = expired.map((item) => item.board);
    await commit({ ...data, posts: data.posts.filter((item) => !gone.has(item.id)) }, boards);
  }

  return {
    // Queued like every mutation, so a post made while the file loads waits for it.
    start: () =>
      exclusive(async () => {
        data = await ports.store.load();
        await prunePosts();
      }),
    boards() {
      const grouped: Record<string, Post[]> = {};
      for (const board of new Set(data.posts.map((item) => item.board)))
        grouped[board] = postsOf(board);
      return grouped;
    },
    wakesPaused: () => data.wakesPaused,
    post: (input) => exclusive(() => createPost(input)),
    update: (input) => exclusive(() => updatePost(input)),
    remove: (id) =>
      exclusive(async (): Promise<DeleteResult> => {
        const post = data.posts.find((item) => item.id === id);
        if (!post) return { ok: false, error: `Unable to delete ${id}: no such post` };
        const posts = data.posts.filter((item) => item.id !== id);
        const saved = await commit({ ...data, posts }, [post.board]);
        return saved.ok ? { ok: true } : saved;
      }),
    read(board, since) {
      const posts = postsOf(board);
      if (since === null) {
        const page = posts.slice(-READ_POST_MAX);
        return { posts: page, cursor: page.at(-1)?.seq ?? 0, more: false };
      }
      const newer = posts.filter((item) => item.seq > since);
      const page = newer.slice(0, READ_POST_MAX);
      return { posts: page, cursor: page.at(-1)?.seq ?? since, more: newer.length > page.length };
    },
    removeBoard: (board) =>
      exclusive(async () => {
        const posts = data.posts.filter((item) => item.board !== board);
        if (posts.length !== data.posts.length) {
          const saved = await commit({ ...data, posts }, []);
          if (!saved.ok) return;
        }
        tell(() => ports.onBoardRemoved(board));
      }),
    setWakesPaused: (paused) =>
      exclusive(async () => {
        const saved = await commit({ ...data, wakesPaused: paused }, []);
        if (!saved.ok) throw new Error(saved.error);
      }),
    prune: () => exclusive(prunePosts),
  };
}
