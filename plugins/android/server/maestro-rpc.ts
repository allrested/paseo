import type { PluginHandlerContext, PluginServerContext } from "@getpaseo/plugin/server";
import {
  maestroAgentsRpc,
  maestroFlowsRpc,
  maestroRunSubscription,
  maestroSendRpc,
  maestroStartRpc,
  maestroStopRpc,
  type MaestroRunState,
} from "../shared/contracts.js";
import { errorMessage } from "./errors.js";
import type { MaestroRunner } from "./maestro.js";

type Paseo = PluginHandlerContext["paseo"];

/** The one prompt Send to agent gives: the flow, where it failed, and the output's tail. */
export function buildMaestroPrompt(run: MaestroRunState, note: string): string {
  const outcome =
    run.status === "failed"
      ? `failed${run.failedStep ? ` at ${JSON.stringify(run.failedStep)}` : ""}`
      : run.status;
  return [
    note.trim() || "Look into this Maestro run.",
    "",
    `The Maestro flow ${run.flow} ${outcome} on the stack's Android device.`,
    ...(run.message ? [`Message: ${run.message}`] : []),
    ...(run.hasPicture ? ["The attached picture is the screen when it failed."] : []),
    "",
    "Last output:",
    "```",
    ...run.output,
    "```",
  ].join("\n");
}

async function workspaceDir(paseo: Paseo, workspaceId: string): Promise<string> {
  const snapshot = await paseo.workspaces.ref(workspaceId).refresh();
  const directory = snapshot?.workspaceDirectory ?? snapshot?.projectRootPath;
  if (!directory) throw new Error("This workspace has no folder");
  return directory;
}

// Runs in the daemon process: every handler answers instead of throwing.
export function registerMaestro(
  server: Pick<PluginServerContext, "handle">,
  runner: MaestroRunner,
  log: (message: string) => void,
): void {
  server.handle(maestroFlowsRpc, async ({ workspaceId }, context) => {
    try {
      return { flows: await runner.flows(await workspaceDir(context.paseo, workspaceId)) };
    } catch (error) {
      return { flows: [], error: errorMessage(error) };
    }
  });
  server.handle(maestroStartRpc, async ({ workspaceId, flow }, context) => {
    try {
      return await runner.start({ dir: await workspaceDir(context.paseo, workspaceId), flow });
    } catch (error) {
      log(`[android] Maestro start failed: ${errorMessage(error)}`);
      return { ok: false, error: errorMessage(error) };
    }
  });
  server.handle(maestroStopRpc, async () => {
    await runner.stop();
    return { ok: true };
  });
  server.handle(maestroRunSubscription, async (_input, context) => {
    const push = (run: MaestroRunState | null) => void context.push({ run }).catch(() => undefined);
    const unwatch = runner.watch(push);
    try {
      push(runner.state());
      if (!context.signal.aborted) {
        await new Promise<void>((resolve) =>
          context.signal.addEventListener("abort", () => resolve(), { once: true }),
        );
      }
    } finally {
      unwatch();
    }
  });
  server.handle(maestroAgentsRpc, async ({ workspaceId }, context) => {
    try {
      const { entries } = await context.paseo.agents.list();
      return {
        agents: entries
          .map((entry) => entry.agent)
          .filter((agent) => agent.workspaceId === workspaceId && !agent.archivedAt)
          .map((agent) => ({ id: agent.id, title: agent.title ?? agent.id.slice(0, 8) })),
      };
    } catch (error) {
      log(`[android] listing agents failed: ${errorMessage(error)}`);
      return { agents: [] };
    }
  });
  server.handle(maestroSendRpc, async ({ runId, agentId, note }, context) => {
    try {
      const run = runner.state();
      if (!run || run.id !== runId)
        return { ok: false, error: "That run is no longer the last one" };
      if (run.status === "running") return { ok: false, error: "The flow is still running" };
      const picture = run.hasPicture ? await runner.failurePicture(run.id) : null;
      const images = picture ? [{ mimeType: "image/png", data: picture.toString("base64") }] : [];
      await context.paseo.agents
        .ref(agentId)
        .send(buildMaestroPrompt(run, note), { activeTurnBehavior: "steer", images });
      return { ok: true };
    } catch (error) {
      return { ok: false, error: errorMessage(error) };
    }
  });
}
