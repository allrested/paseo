import path from "node:path";
import { expect, type Page } from "@playwright/test";
import { getMovedFromAgentId } from "@getpaseo/protocol/agent-labels";
import {
  createMockIdleAgent,
  expectWorkspaceTabHidden,
  expectWorkspaceTabVisible,
} from "./archive-tab";
import { openAgentRoute } from "./mock-agent";
import { connectNewWorkspaceDaemonClient } from "./new-workspace";
import { seedWorkspace, type SeedDaemonClient } from "./seed-client";
import { waitForWorkspaceTabsVisible } from "./workspace-tabs";

/** The provider the ACP fixture plugin registers: the only other one that runs in the E2E daemon. */
const SECOND_PROVIDER = "acp-chunks";

export interface MovableAgent {
  client: SeedDaemonClient;
  agentId: string;
}

/**
 * A mock agent open in its workspace, on a host that has a second provider to move it to.
 * The E2E daemon runs agents on `mock` alone, so the ACP fixture plugin supplies the other one.
 */
export async function withMovableAgent(
  page: Page,
  run: (agent: MovableAgent) => Promise<void>,
): Promise<void> {
  const workspace = await seedWorkspace({ repoPrefix: "session-move-" });
  const pluginClient = await connectNewWorkspaceDaemonClient();
  const previous = await pluginClient.getDaemonConfig();
  try {
    await pluginClient.patchDaemonConfig({ pluginsEnabled: true });
    await pluginClient.installDirectoryPlugin(
      path.resolve(__dirname, "../fixtures/acp-chunks-plugin"),
    );
    const agent = await createMockIdleAgent(workspace.client, {
      cwd: workspace.repoPath,
      workspaceId: workspace.workspaceId,
      title: "Session to move",
    });
    await openAgentRoute(page, { workspaceId: workspace.workspaceId, agentId: agent.id });
    await waitForWorkspaceTabsVisible(page);
    await expectWorkspaceTabVisible(page, agent.id);
    await run({ client: workspace.client, agentId: agent.id });
  } finally {
    try {
      await pluginClient.removePlugin("acp-chunks-test");
      await pluginClient.patchDaemonConfig({ pluginsEnabled: previous.config.pluginsEnabled });
    } finally {
      await pluginClient.close();
      await workspace.cleanup();
    }
  }
}

/** Moves the agent to the second provider from its tab menu, the way a person does. */
export async function moveAgentToSecondProvider(page: Page, agent: MovableAgent): Promise<void> {
  await page.getByTestId(`workspace-tab-agent_${agent.agentId}`).first().click({ button: "right" });
  await page.getByTestId(`workspace-tab-context-agent_${agent.agentId}-move-agent`).click();
  const dialog = page.getByTestId("move-session-dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByTestId(`move-session-target-${SECOND_PROVIDER}`).click();
  await dialog.getByTestId("move-session-submit").click();
  await expect(dialog).toHaveCount(0, { timeout: 30_000 });
}

/** The live agent the daemon moved `fromAgentId` to. */
async function findSuccessor(
  client: SeedDaemonClient,
  fromAgentId: string,
): Promise<string | null> {
  const { entries } = await client.fetchAgents({ scope: "active" });
  const successor = entries.find(
    (entry) => getMovedFromAgentId(entry.agent.labels) === fromAgentId,
  );
  return successor?.agent.id ?? null;
}

/**
 * The agent's tab now shows its successor on the second provider, with the way back offered.
 * Returns the successor's id.
 */
export async function expectAgentMoved(page: Page, agent: MovableAgent): Promise<string> {
  await expect
    .poll(() => findSuccessor(agent.client, agent.agentId), { timeout: 30_000 })
    .not.toBeNull();
  const successorId = await findSuccessor(agent.client, agent.agentId);
  if (!successorId) throw new Error(`No agent was moved from ${agent.agentId}`);
  await expectWorkspaceTabVisible(page, successorId);
  await expectWorkspaceTabHidden(page, agent.agentId);
  await expect(page.getByTestId("move-banner-moved-from")).toContainText("Moved from");
  return successorId;
}

export async function moveAgentBack(page: Page): Promise<void> {
  await page.getByTestId("move-banner-move-back").click();
}

/** The tab is back on the original agent, and the successor is gone from the workspace. */
export async function expectAgentMovedBack(
  page: Page,
  agent: MovableAgent,
  successorId: string,
): Promise<void> {
  await expectWorkspaceTabVisible(page, agent.agentId);
  await expectWorkspaceTabHidden(page, successorId);
  await expect
    .poll(
      async () => {
        const { entries } = await agent.client.fetchAgents({ scope: "active" });
        return entries.map((entry) => entry.agent.id);
      },
      { timeout: 30_000 },
    )
    .toEqual([agent.agentId]);
}
