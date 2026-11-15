import { homedir } from "node:os";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import { TrackerError } from "./server/issue.js";
import { tokensFile } from "./server/paths.js";
import { createTasks } from "./server/tasks.js";
import { createTokenStore, type TokenStore } from "./server/token-store.js";
import { linkedWorkspaces } from "./server/workspaces.js";
import {
  addCommentRpc,
  changeStatusRpc,
  connections,
  linkedWorkspacesRpc,
  listTasksRpc,
  searchAttachmentsRpc,
  searchTasksRpc,
  setTokenRpc,
  taskDetailRpc,
  taskPromptRpc,
  testConnectionRpc,
  tokensRpc,
} from "./shared/contracts.js";

/** What the plugin needs from outside the daemon's plugin API. */
export interface TasksPluginDeps {
  tokens: TokenStore;
  request: typeof fetch;
  log(message: string): void;
}

export function createTasksPlugin(server: PluginServerContext, deps: TasksPluginDeps): () => void {
  const settings = server.registerSettings(connections);
  const tasks = createTasks({
    ...deps,
    async connections() {
      const state = await settings.read();
      if (state.status !== "ready") {
        throw new TrackerError(`The task connections cannot be read: ${state.error}`);
      }
      return state.values;
    },
  });

  server.handle(searchTasksRpc, ({ query }) => tasks.search(query));
  server.handle(searchAttachmentsRpc, ({ query }) => tasks.attachments(query));
  server.handle(listTasksRpc, ({ query }) => tasks.list(query));
  server.handle(taskDetailRpc, ({ id }) => tasks.detail(id));
  server.handle(addCommentRpc, (input) => tasks.comment(input));
  server.handle(changeStatusRpc, (input) => tasks.change(input));
  server.handle(linkedWorkspacesRpc, async (_input, { paseo }) =>
    tasks.linked(await linkedWorkspaces((request) => paseo.workspaces.list(request))),
  );
  server.handle(taskPromptRpc, ({ id }) => tasks.prompt(id));
  server.handle(tokensRpc, () => tasks.tokens());
  server.handle(setTokenRpc, (input) => tasks.setToken(input));
  server.handle(testConnectionRpc, ({ source }) => tasks.test(source));

  return () => {};
}

export default function contribute(server: PluginServerContext): () => void {
  const log = (message: string) => console.error(message);
  return createTasksPlugin(server, {
    // Built-ins run in the daemon process, so process.env is the daemon's env.
    tokens: createTokenStore({ file: tokensFile(process.env, homedir()), log }),
    request: fetch,
    log,
  });
}
