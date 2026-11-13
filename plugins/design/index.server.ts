import { homedir } from "node:os";
import { join } from "node:path";
import type { PluginHandlerContext, PluginServerContext } from "@getpaseo/plugin/server";
import { readDesignConfig } from "./server/config.js";
import {
  addCommentRpc,
  agentsRpc,
  createFileRpc,
  designFilesRpc,
  editorLinkRpc,
  removeFileRpc,
  renameFileRpc,
  sendRpc,
  viewSubscription,
} from "./shared/contracts.js";
import { createDesignService } from "./server/design.js";

// The packaged app resolves only the plugin SDK, so the API type comes from it, not @getpaseo/client.
type PaseoApi = PluginHandlerContext["paseo"];

const TICK_MS = 10_000;

/** What the daemon passes a built-in beside the server context (as in plugins/default-skills). */
interface BuiltinPluginInfo {
  directory: string;
}

export default function contribute(
  server: PluginServerContext,
  builtin?: BuiltinPluginInfo,
): () => Promise<void> {
  const log = (line: string) => console.error(line);
  let paseo: PaseoApi | null = null;
  const remember = (context: { paseo: PaseoApi }) => {
    paseo = context.paseo;
  };
  // Built-ins run in the daemon process, so process.env is the daemon's env.
  // The guard ships in bin/ beside this code; a bundle has no usable import.meta.url.
  const config = builtin
    ? readDesignConfig(process.env)
    : { disabled: "Design mode runs only as Paseo's built-in plugin" };
  const service = createDesignService({
    config,
    env: process.env,
    home: homedir(),
    guardPath: builtin ? join(builtin.directory, "bin", "figcraft-guard.mjs") : "",
    paseo: () => {
      if (paseo === null) throw new Error("Design mode is not ready yet");
      return paseo;
    },
    log,
  });

  server.handle(
    designFilesRpc,
    (input, context) => (remember(context), service.files(input.workspaceId)),
  );
  server.handle(
    createFileRpc,
    (input, context) => (remember(context), service.create(input.workspaceId, input.name)),
  );
  server.handle(
    renameFileRpc,
    (input, context) => (remember(context), service.rename(input.fileId, input.name)),
  );
  server.handle(
    removeFileRpc,
    (input, context) => (remember(context), service.remove(input.fileId)),
  );
  server.handle(
    editorLinkRpc,
    (input, context) => (remember(context), service.editorLink(input.fileId, input.workspaceId)),
  );
  server.handle(
    addCommentRpc,
    (input, context) => (
      remember(context), service.comment(input.fileId, input.x, input.y, input.text)
    ),
  );
  server.handle(
    sendRpc,
    (input, context) => (remember(context), service.send(input.fileId, input.agentId, input.note)),
  );
  server.handle(
    agentsRpc,
    (input, context) => (remember(context), service.agents(input.workspaceId)),
  );
  server.handle(viewSubscription, (input, context) => {
    remember(context);
    return service.view(input, (event) => context.push(event), context.signal);
  });

  // Off on this host: the RPCs say why, and no hook is added (adding one reloads every session).
  if ("disabled" in config) return () => service.stop();

  const timer = setInterval(() => {
    if (paseo !== null)
      void service.tick().catch((error: Error) => log(`[design] tick failed: ${error.message}`));
  }, TICK_MS);
  timer.unref();

  const removeHooks = [
    server.addHook("agent.open.before", async ({ request }, context) => {
      try {
        remember(context);
        return (await service.openSession(request)) ?? undefined;
      } catch (error) {
        log(`[design] agent.open.before failed: ${(error as Error).message}`);
        return undefined;
      }
    }),
    server.addHook("agent.turn.after", async ({ agent }, context) => {
      try {
        remember(context);
        await service.turnEnded(agent.id);
      } catch (error) {
        log(`[design] agent.turn.after failed: ${(error as Error).message}`);
      }
    }),
    server.addHook("agent.close.after", async ({ agent }) => service.agentGone(agent.id)),
    server.addHook("agent.archive.after", async ({ agent }) => service.agentGone(agent.id)),
  ];

  return async () => {
    clearInterval(timer);
    for (const remove of removeHooks) remove();
    await service.stop();
  };
}
