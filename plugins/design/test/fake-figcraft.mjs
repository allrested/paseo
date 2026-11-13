#!/usr/bin/env node
// A stand-in for `figcraft-cli mcp` in unit tests, answering in the shapes the real contract test
// recorded in fixtures/ (FigCraft 0.18.1). It ignores its arguments. Controls, all optional:
//   FAKE_FIGCRAFT_LOG          a file that receives one JSON line per tools/call
//   FAKE_FIGCRAFT_CRASH_AFTER  on the tools/call after the n-th, print a link to stderr, exit 3
//   FAKE_FIGCRAFT_SELECTION    comma-separated layer ids a user ("Guest 3") has selected
//   FAKE_FIGCRAFT_AGENT_SELECTION  the same for an agent member ("Claude (agent)")
//   FAKE_FIGCRAFT_COMMENTS     a JSON array that comment.list answers with
//   FAKE_FIGCRAFT_EMPTY=1      the page has no layers (screenshot fails, no bounds)
import { appendFileSync, readFileSync } from "node:fs";
import { createInterface } from "node:readline";

const fixtures = new URL("./fixtures/", import.meta.url);
const fixture = (name) => JSON.parse(readFileSync(new URL(name, fixtures), "utf8"));
const env = process.env;
const log = env.FAKE_FIGCRAFT_LOG;
const crashAfter = Number(env.FAKE_FIGCRAFT_CRASH_AFTER ?? "0");
const empty = env.FAKE_FIGCRAFT_EMPTY === "1";
// As FigCraft 0.18.1: a session confined with automation roots has no network.
const confined = process.argv.some((arg) => arg.startsWith("--automation-"));
const NETWORK = new Set(["collab.publish", "collab.join", "collab.share", "collab.host"]);
const PNG_1PX =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

let calls = 0;
let clientName = "client";
let myName = null;
let joined = null; // "published" | "joined" | null
let variables = { meta: { variableCollections: {}, variables: {} } };
const comments = [];

// Real layer ids are numbers; a test's "n1" stays a string so it reads back as given.
const ids = (list) =>
  list ? list.split(",").map((id) => (/^\d+$/.test(id) ? Number(id) : id)) : [];

function members() {
  const out = [];
  if (env.FAKE_FIGCRAFT_SELECTION !== undefined) {
    out.push({ id: 3, name: "Guest 3", presence: { selection: ids(env.FAKE_FIGCRAFT_SELECTION) } });
  }
  if (env.FAKE_FIGCRAFT_AGENT_SELECTION !== undefined) {
    out.push({
      id: 4,
      name: "Claude (agent)",
      presence: { selection: ids(env.FAKE_FIGCRAFT_AGENT_SELECTION) },
    });
  }
  return out;
}

function peers() {
  if (joined === null) return { ...fixture("publish.json"), status: "offline", sessions: [] };
  const live = fixture(joined === "published" ? "peers-publisher.json" : "peers-member.json");
  const link = "figcraft://join?host=127.0.0.1:1&file=f1&token=e";
  return {
    ...live,
    name: myName ?? "Guest 1",
    link,
    published:
      joined === "published"
        ? {
            ...live.published,
            edit: link,
            view: "figcraft://join?host=127.0.0.1:1&file=f1&token=v",
          }
        : null,
    peers: members(),
  };
}

function command(name, params) {
  switch (name) {
    case "pref.userName":
      myName = params.name;
      return { name: params.name };
    case "collab.publish":
      joined = "published";
      return fixture("publish.json");
    case "collab.join":
      joined = "joined";
      return { ...fixture("publish.json"), document: 1 };
    case "collab.peers":
      return peers();
    case "variable.import":
      variables = params.variables;
      return {
        collections: Object.keys(variables.meta.variableCollections).length,
        updated: 0,
        variables: Object.keys(variables.meta.variables).length,
        warnings: [],
      };
    case "variable.export":
      return { text: JSON.stringify({ error: false, meta: variables.meta, status: 200 }) };
    case "comment.add": {
      const id = 100 + comments.length;
      comments.push({
        agent: true,
        author: `${clientName} (agent)`,
        id,
        resolved: false,
        text: params.text,
        x: params.x,
        y: params.y,
      });
      return { id, link: `figcraft://comment/${id}` };
    }
    case "comment.list":
      return {
        comments: env.FAKE_FIGCRAFT_COMMENTS ? JSON.parse(env.FAKE_FIGCRAFT_COMMENTS) : comments,
      };
    case "comment.prompt": {
      const wanted = params.ids ?? [];
      return {
        comments: [],
        count: wanted.length,
        text: `# FigCraft feedback\n\nThreads: ${wanted.join(",")}`,
        truncated: false,
      };
    }
    case "inspect.code":
      return {
        code: `export function Layer${params.id}() {\n  return <div className="p-4" />;\n}\n`,
        connected: false,
        language: params.language ?? "tailwind",
      };
    default:
      return { ok: true };
  }
}

const text = (value) => ({ content: [{ type: "text", text: JSON.stringify(value, null, 2) }] });
const failure = (message) => ({ content: [{ type: "text", text: message }], isError: true });

function tool(name, args) {
  switch (name) {
    case "run_command":
      if (confined && NETWORK.has(args.command)) {
        return failure(
          `command \`${args.command}\` is not available right now: automation roots are set: commands don't reach the network (publishing, live sessions, team libraries and plugin directories are off)`,
        );
      }
      return text(command(args.command, args.params ?? {}));
    case "screenshot":
      if (empty) return failure("the current page is empty: nothing to render");
      return {
        content: [
          { type: "image", mimeType: "image/png", data: PNG_1PX },
          {
            type: "text",
            text: JSON.stringify({
              height: 200,
              ids: args.ids ?? [],
              scale: 1.0,
              source: args.ids ? "layers" : "page",
              width: 320,
            }),
          },
        ],
      };
    case "inspect_document": {
      const doc = fixture("inspect-document.json");
      if (empty) doc.pages[0].children = [];
      return text(doc);
    }
    default:
      return text({ ok: true });
  }
}

function reply(id, result) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, result })}\n`);
}

createInterface({ input: process.stdin }).on("line", (line) => {
  const message = JSON.parse(line);
  if (message.method === "initialize") {
    clientName = message.params?.clientInfo?.name ?? clientName;
    return reply(message.id, {
      protocolVersion: "2025-06-18",
      capabilities: { tools: {} },
      serverInfo: { name: "fake-figcraft", version: "0" },
    });
  }
  if (message.method === "tools/list") {
    return reply(message.id, {
      tools: ["run_command", "screenshot", "inspect_document", "create_node", "select"].map(
        (name) => ({ name, inputSchema: { type: "object" } }),
      ),
    });
  }
  if (message.method !== "tools/call") {
    return message.id === undefined ? undefined : reply(message.id, {});
  }
  calls += 1;
  if (log) appendFileSync(log, `${JSON.stringify(message.params)}\n`);
  if (crashAfter > 0 && calls > crashAfter) {
    process.stderr.write("lost figcraft://join?host=h&file=f&token=secret-token\n");
    process.exit(3);
  }
  return reply(message.id, tool(message.params.name, message.params.arguments ?? {}));
});
