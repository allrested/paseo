// Which FigCraft calls an agent's figcraft-cli may make. Plain JS: the guard runs under node
// without a build step. Paseo publishes files and hands out links; agents only join ours.
// Command names and link forms are FigCraft 0.18.1's, from its own `list_commands`.

// The live-session commands that stay inside the file the agent joined. Every other collab.*
// command reaches a server (share, publish, host, server files, reports), so it is refused, as is
// any collab.* command a later FigCraft adds.
const COLLAB_ALLOWED = new Set([
  "collab.join",
  "collab.peers",
  "collab.leave",
  "collab.stop",
  "collab.reconnect",
  "collab.diff",
  "collab.serverInfo",
  "collab.follow",
  "collab.cursor",
  "collab.cursorChat",
  "collab.spotlight",
]);
const REFUSED = new Set(["library.publishToServer", "pref.publishServer"]);
// Commands that take a server or a link: allowed only towards ours. A local library file is fine.
const SERVER_PARAM = new Map([
  ["collab.serverInfo", "server"],
  ["library.add", "path"],
]);
const AGENT_SUFFIX = " (agent)";

function hostnameOf(host) {
  try {
    return new URL(`ws://${host}`).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/** The server a FigCraft invite link names, or null for a join code or anything else. */
function linkHostname(link) {
  let url;
  try {
    url = new URL(link);
  } catch {
    return null;
  }
  if (url.protocol === "ws:" || url.protocol === "wss:") return url.hostname.toLowerCase();
  if (url.protocol !== "figcraft:") return null;
  const host = url.searchParams.get("host");
  if (host) return hostnameOf(host);
  const server = url.searchParams.get("server");
  return server ? linkHostname(server) : null;
}

function refuseCommand(command, params, ourServer) {
  const sharing =
    REFUSED.has(command) ||
    command.startsWith("plugin.directory.") ||
    (command.startsWith("collab.") && !COLLAB_ALLOWED.has(command));
  if (sharing) {
    return `${command} is not allowed here: Paseo shares design files for you`;
  }
  const ours = new URL(ourServer).hostname.toLowerCase();
  const param = SERVER_PARAM.get(command);
  if (param) {
    const given = String(params?.[param] ?? "");
    const remote = /^(wss?|figcraft):/i.test(given);
    if (remote && linkHostname(given) !== ours) return `${command} may only reach ${ours}`;
  }
  if (command === "collab.join") {
    const given = [params?.link, params?.code].find((value) => typeof value === "string") ?? "";
    if (linkHostname(given) !== ours) return `collab.join may only join files on ${ours}, by link`;
  }
  return null;
}

/** @returns {string | null} why the call is refused, or null when it may go through */
export function refusal(toolName, args, ourServer) {
  if (toolName === "run_command") {
    return refuseCommand(String(args?.command ?? ""), args?.params, ourServer);
  }
  if (toolName === "batch") {
    for (const step of Array.isArray(args?.commands) ? args.commands : []) {
      const command = String(step?.command ?? "");
      if (command === "pref.userName") {
        return "pref.userName is not allowed in a batch; run it on its own";
      }
      const why = refuseCommand(command, step?.params, ourServer);
      if (why) return why;
    }
  }
  return null;
}

/** The name an agent shows in a live session, marked so the user's selection can be told apart. */
export function agentName(name) {
  const base = String(name ?? "").trim() || "Agent";
  return base.endsWith(AGENT_SUFFIX) ? base : `${base}${AGENT_SUFFIX}`;
}

/** @returns {object | null} the call's new arguments, or null to pass it unchanged */
export function rewrite(toolName, args) {
  if (toolName !== "run_command" || args?.command !== "pref.userName") return null;
  const name = agentName(args.params?.name);
  if (name === args.params?.name) return null;
  return { ...args, params: { ...args.params, name } };
}
