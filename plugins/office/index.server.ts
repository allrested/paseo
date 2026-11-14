import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import { readThreeAsset } from "./server/asset.js";
import { createBoardStore, type BoardStore } from "./server/board-store.js";
import { errorMessage } from "./server/errors.js";
import { createHub } from "./server/hub.js";
import { liveAgentPorts, liveHubPorts } from "./server/live-ports.js";
import { createOffice } from "./server/office.js";
import { createPaseoHolder } from "./server/paseo-holder.js";
import { boardsFile } from "./server/paths.js";
import {
  createRenderPageHost,
  type PagesPort,
  type RenderPageHost,
} from "./server/render/page-host.js";
import { createRenderSessions } from "./server/render/sessions.js";
import { createSheetPageHost, type SheetPageHost } from "./server/render/sheet-page-host.js";
import { createSheetSessions } from "./server/render/sheet-sessions.js";
import { nodeClock, type Clock } from "./server/timers.js";
import {
  assetRpc,
  deleteRpc,
  officeStateSubscription,
  postRpc,
  renderInputRpc,
  renderSubscription,
  setWakesPausedRpc,
  sheetInputRpc,
  sheetSpriteRpc,
  sheetSubscription,
  updateRpc,
} from "./shared/contracts.js";
import { officeHostSettings } from "./shared/settings.js";

/** What the daemon passes a built-in beside the server context (as in plugins/default-skills). */
interface BuiltinPluginInfo {
  directory: string;
  /** Pages in the daemon's Chromium that no pane or agent sees; absent without a Chromium. */
  offscreenPages?: PagesPort;
  /** Builds one self-contained browser script from an entry file. */
  bundleBrowserScript?: (entryPath: string) => Promise<string>;
}

/** What the office needs from outside the daemon's plugin API. */
export interface OfficePluginDeps {
  store: BoardStore;
  clock: Clock;
  log(message: string): void;
  /** The folder of the vendored three.js build, or null when the daemon named no plugin folder. */
  vendorDirectory: string | null;
  /** Draws the 3D view on the host for a device that cannot; null when the host has no browser. */
  render: RenderPageHost | null;
  /** Draws the office as pictures and positions on the host; null when the host has no browser. */
  sheet: SheetPageHost | null;
}

// Runs inside the daemon process: every handler, hook and timer catches its own errors.
export function createOfficePlugin(
  server: PluginServerContext,
  deps: OfficePluginDeps,
): () => Promise<void> {
  const { log, vendorDirectory } = deps;
  const holder = createPaseoHolder();
  const hub = createHub({
    ...liveHubPorts(holder, deps.clock, log),
    renderAvailable: () => deps.render !== null,
  });
  const renderSessions = createRenderSessions({
    host: deps.render,
    hub,
    clock: deps.clock,
    newStreamId: randomUUID,
    log,
  });
  const sheetSessions = createSheetSessions({
    host: deps.sheet,
    hub,
    clock: deps.clock,
    newSheetId: randomUUID,
    log,
  });
  const office = createOffice({
    store: deps.store,
    clock: deps.clock,
    hub,
    agents: liveAgentPorts(holder),
    log,
  });

  const settings = server.registerSettings(officeHostSettings);

  async function guarded<T>(name: string, work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      log(`[office] ${name} failed: ${errorMessage(error)}`);
      throw error;
    }
  }

  // The handler's promise settles when the subscriber leaves (or the directory cannot start),
  // and settling closes the subscription; see Hub.attach.
  server.handle(officeStateSubscription, (_input, context) => {
    holder.remember(context.paseo);
    return hub.attach(context);
  });
  server.handle(assetRpc, () => guarded("asset", () => readThreeAsset(vendorDirectory)));
  // Resolves when the stream ends, which closes the subscription. It never rejects: a stream
  // that cannot run says why in a problem event first.
  server.handle(renderSubscription, (input, context) => {
    holder.remember(context.paseo);
    return renderSessions.attach(input, context);
  });
  server.handle(renderInputRpc, (input) => renderSessions.input(input));
  // Same as the stream: resolves when the sheet ends, and says why in a problem event first.
  server.handle(sheetSubscription, (input, context) => {
    holder.remember(context.paseo);
    return sheetSessions.attach(input, context);
  });
  server.handle(sheetInputRpc, (input) => sheetSessions.input(input));
  server.handle(sheetSpriteRpc, (input) => sheetSessions.sprite(input));
  server.handle(postRpc, (input, context) => {
    holder.remember(context.paseo);
    return guarded("post", () => office.post(input));
  });
  server.handle(updateRpc, (input, context) => {
    holder.remember(context.paseo);
    return guarded("update", () => office.update(input));
  });
  server.handle(deleteRpc, (input, context) => {
    holder.remember(context.paseo);
    return guarded("delete", () => office.remove(input.id));
  });
  server.handle(setWakesPausedRpc, (input, context) => {
    holder.remember(context.paseo);
    return guarded("pause", () => office.setWakesPaused(input.paused));
  });

  const removeHooks = [
    server.addHook("agent.open.before", async ({ request }, context) => {
      try {
        holder.remember(context.paseo);
        office.noteAgent({
          id: request.agentId,
          workspaceId: request.workspaceId,
          title: request.title,
        });
        if (request.purpose !== "interactive") return undefined;
        // Read here and not kept: a session opened while a first read was still on its way would
        // get the tools after the owner turned them off. A read that fails gives no tools.
        const state = await settings.read();
        if (state.status === "ready" && !state.values.agentTools) return undefined;
        return { ...request, tools: [...request.tools, ...office.tools] };
      } catch (error) {
        log(`[office] agent.open.before failed: ${errorMessage(error)}`);
        return undefined;
      }
    }),
    server.addHook("agent.turn.after", async ({ agent }, context) => {
      try {
        holder.remember(context.paseo);
        office.noteAgent(agent);
        office.turnEnded(agent.id);
      } catch (error) {
        log(`[office] agent.turn.after failed: ${errorMessage(error)}`);
      }
    }),
    server.addHook("agent.close.after", async ({ agent }) => {
      try {
        office.agentGone(agent.id);
      } catch (error) {
        log(`[office] agent.close.after failed: ${errorMessage(error)}`);
      }
    }),
    server.addHook("agent.archive.after", async ({ agent }) => {
      try {
        office.agentGone(agent.id);
      } catch (error) {
        log(`[office] agent.archive.after failed: ${errorMessage(error)}`);
      }
    }),
    server.addHook("workspace.archive.after", async ({ workspace }) => {
      try {
        await office.workspaceArchived(workspace.id);
      } catch (error) {
        log(`[office] workspace.archive.after failed: ${errorMessage(error)}`);
      }
    }),
  ];

  return async () => {
    for (const remove of removeHooks) remove();
    await renderSessions.stop();
    await sheetSessions.stop();
    office.stop();
    await hub.stop();
  };
}

export default function contribute(
  server: PluginServerContext,
  builtin?: BuiltinPluginInfo,
): () => Promise<void> {
  const log = (message: string) => console.error(message);
  const vendorDirectory = builtin ? join(builtin.directory, "vendor") : null;
  return createOfficePlugin(server, {
    // Built-ins run in the daemon process, so process.env is the daemon's env.
    store: createBoardStore({
      file: boardsFile(process.env, homedir()),
      now: () => Date.now(),
      log,
    }),
    clock: nodeClock,
    log,
    vendorDirectory,
    render:
      builtin?.offscreenPages && builtin.bundleBrowserScript
        ? createRenderPageHost({
            pages: builtin.offscreenPages,
            bundle: builtin.bundleBrowserScript,
            readThree: () => readThreeAsset(vendorDirectory),
            pageEntry: join(builtin.directory, "render", "page.ts"),
          })
        : null,
    sheet:
      builtin?.offscreenPages && builtin.bundleBrowserScript
        ? createSheetPageHost({
            pages: builtin.offscreenPages,
            bundle: builtin.bundleBrowserScript,
            readThree: () => readThreeAsset(vendorDirectory),
            pageEntry: join(builtin.directory, "render", "sheet-page.ts"),
          })
        : null,
  });
}
