import { test } from "../support/fixtures";
import {
  expectAgentMoved,
  expectAgentMovedBack,
  moveAgentBack,
  moveAgentToSecondProvider,
  withMovableAgent,
} from "../support/helpers/session-move";

test.describe("Session move", () => {
  test("user moves an agent to another provider and back", async ({ page }) => {
    test.setTimeout(180_000);

    await withMovableAgent(page, async (agent) => {
      await moveAgentToSecondProvider(page, agent);
      const successorId = await expectAgentMoved(page, agent);

      await moveAgentBack(page);
      await expectAgentMovedBack(page, agent, successorId);
    });
  });
});
