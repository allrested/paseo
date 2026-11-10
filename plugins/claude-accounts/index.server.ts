import { homedir } from "node:os";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import { createClaudeAccounts } from "./server/accounts.js";
import { accountsApi } from "./server/paseo-port.js";
import { profilePaths } from "./server/profiles.js";
import {
  addAccountRpc,
  listAccountsRpc,
  moveIdleRpc,
  removeAccountRpc,
  signInRpc,
} from "./shared/rpc.js";
import { claudeAccountsSettings } from "./shared/settings.js";

export default function contribute(server: PluginServerContext) {
  const settings = server.registerSettings(claudeAccountsSettings);
  // Built-ins run in the daemon process, so process.env is the daemon's env.
  const accounts = createClaudeAccounts({
    paths: profilePaths(process.env, homedir()),
    platform: process.platform,
    readDefaultAccount: async () => {
      const state = await settings.read();
      return state.status === "ready" ? state.values.defaultAccount : null;
    },
    logError: (message, error) => console.error(message, error),
  });
  server.handle(listAccountsRpc, (_input, { paseo }) => accounts.list(accountsApi(paseo)));
  server.handle(addAccountRpc, ({ name }, { paseo }) => accounts.add(accountsApi(paseo), name));
  server.handle(removeAccountRpc, ({ provider }, { paseo }) =>
    accounts.remove(accountsApi(paseo), provider),
  );
  server.handle(signInRpc, ({ provider }, { paseo }) =>
    accounts.signIn(accountsApi(paseo), provider),
  );
  server.handle(moveIdleRpc, ({ from, to }, { paseo }) =>
    accounts.moveIdle(accountsApi(paseo), from, to),
  );
  // One hook for the plugin's lifetime. It sees every creation that is not internal, history
  // handoffs included; a native move creates no agent and skips it.
  const removeHook = server.addHook("agent.create.before", async ({ request }, { paseo }) => {
    const { config } = request;
    const provider = await accounts.beforeCreate(accountsApi(paseo), {
      provider: config.provider,
      cwd: config.cwd,
    });
    return provider === config.provider ? request : { ...request, config: { ...config, provider } };
  });
  return async function cleanup(): Promise<void> {
    removeHook();
    await accounts.stop();
  };
}
