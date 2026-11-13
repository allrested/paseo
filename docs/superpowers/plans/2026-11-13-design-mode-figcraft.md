# Design Mode on FigCraft Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A built-in `design` plugin and a self-hosted FigCraft service let the user and agents design screens together on each project's own tokens, view and comment on the phone, and send a selection to an agent to build.

**Architecture:** One `figcraft` Docker stack (pinned `figcraft-server` plus the static `figcraft-web` build behind Caddy) at `figcraft.dev.mtapp.dev`. In the daemon, the `design` built-in keeps a files map per project and runs one headless `figcraft-cli mcp` child ("bridge") per open file, joined to the file's live session; it syncs `design/tokens.json`, reads selection and comments, renders images for the phone and builds Send to agent prompts. Agents get FigCraft's MCP server through a guard that refuses sharing anywhere but our server, plus a `design_join` tool.

**Tech Stack:** TypeScript (plugin server and client, React Native views), zod contracts, vitest, FigCraft v0.18.1 (`figcraft-cli`, `figcraft-server`, `figcraft-web`), Caddy, Docker, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-11-13-design-mode-figcraft-design.md`

## Global Constraints

- FigCraft version pinned: `FIGCRAFT_VERSION=0.18.1`; every downloaded asset is checked against the release's `SHA256SUMS.txt`.
- Official source only: `https://github.com/storytold/figcraft/releases/download/v0.18.1/...`.
- Domain: `figcraft.dev.mtapp.dev`; editor at `https://figcraft.dev.mtapp.dev/app/`; collaboration endpoint `wss://figcraft.dev.mtapp.dev/`.
- Daemon env: `FIGCRAFT_URL` (`wss://figcraft.dev.mtapp.dev/`), `FIGCRAFT_WEB_URL` (`https://figcraft.dev.mtapp.dev/app/`), `FIGCRAFT_SERVER_KEY`. Without `FIGCRAFT_URL` and `FIGCRAFT_SERVER_KEY` the plugin offers nothing (no tools, no list) and says why in the panel.
- Never in git, logs, chat, client messages (except the editor tab's own link) or the phone view: the server key, edit links, owner tokens.
- FigCraft's public server `collab.craftapps.dev` is never used.
- Tokens file: `design/tokens.json` in the workspace directory, W3C design-token format. Repo wins on open.
- At most 3 bridges at once (`DESIGN_MAX_BRIDGES`, default 3); a bridge stops 5 minutes after its last viewer and agent leave; one restart after a crash.
- Phone (store app): view and comment only, React Native views only (no WebView, no DOM).
- Fork commit identity: `env LEFTHOOK=0 GIT_AUTHOR_NAME=tatsuya GIT_AUTHOR_EMAIL=allrested@gmail.com GIT_COMMITTER_NAME=tatsuya GIT_COMMITTER_EMAIL=allrested@gmail.com git commit ...`; stage named paths only.
- Heavy commands one at a time: prefix with `flock -w 480 /tmp/paseo-heavy.lock`. Typecheck plugins with `cd plugins && flock -w 480 /tmp/paseo-heavy.lock npx tsgo -p tsconfig.json --noEmit --singleThreaded`. Run single test files only: `flock -w 480 /tmp/paseo-heavy.lock npx vitest run <file> --bail=1`.
- Lint and format through npm scripts: `npm run lint -- <files>`, `npm run format:files -- <files>`.
- Never start anything on port 6767 or write under `/home/paseo/.paseo`. A dev daemon uses port 6768 with `PASEO_HOME=$PWD/.dev/paseo-home`.
- Nothing is pushed, tagged or deployed without the owner's yes.

## Decisions this plan adds (show the owner at the plan read)

1. **Project key is Paseo's `projectId`** (the workspace's project; worktrees of one repo share it), not the repo's remote URL. A workspace with no project uses its own id. Same intent as the spec, no git remote parsing.
2. **FigCraft write root is a scratch folder** `$PASEO_HOME/design/scratch/<projectKey>/`, read root the workspace's `design/` when it exists. FigCraft refuses a root that does not exist, and creating `design/` in every repo would be intrusive. `design/tokens.json` is written by the plugin's own Node code, not by FigCraft.
3. **Tokens are one collection, one mode** (`Tokens` / `Default`). Composite W3C types (shadow, typography, border, transition, gradient) are kept in the file untouched and not imported, with a warning.
4. **Phone image refresh is a 3-second render poll** while a phone viewer watches, sent only when the PNG changed. FigCraft gives a headless session no change event.
5. **Comments reach "the file's agent"**: the last agent that called `design_join` for the file. With none, comments wait.
6. **Remove forgets a file in Paseo; the file stays on our server** until the operator runs `figcraft-server files remove <id>` (docs/docker.md says how). Removing it from the server needs the publishing session's owner rights, which a later session may not hold; Task 1 does not measure it.
7. **The "components with no codeConnect mapping" mark is deferred** to a follow-up. FigCraft's `codeConnect.export` shape is not documented closely enough to code against; Task 1 records it (`codeconnect.json`) so the follow-up starts from the real shape. The tokens out-of-step mark ships now.

## File Structure

```
plugins/design/
  paseo-plugin.json                  manifest
  index.server.ts                    wiring: config, store, bridges, RPCs, hooks
  index.client.tsx                   panel, screen, Command Center item
  bin/figcraft-guard.mjs             stdio proxy in front of figcraft-cli for agents (plain JS: node runs it)
  bin/guard-policy.mjs               which FigCraft calls an agent may make (plain JS, shipped)
  shared/contracts.ts                RPCs, subscriptions, zod schemas
  shared/config.ts                   env -> DesignConfig
  server/paths.ts                    files.json, scratch dirs, run dir
  server/tokens.ts                   W3C tokens <-> FigCraft variables JSON
  server/files-store.ts              files map per project, atomic writes
  server/pid-files.ts                copied from resource-manager
  server/mcp-stdio-client.ts         adapted from resource-manager
  server/figcraft-session.ts         typed FigCraft calls over an MCP client
  server/bridge.ts                   one open file: join, tokens, selection, renders, comments
  server/bridges.ts                  cap, idle stop, one restart
  server/comments.ts                 new open threads -> one prompt per agent turn
  server/send-to-agent.ts            selection + code + picture -> prompt
  server/agent-tools.ts              design_join
  server/design.ts                   the service the RPCs and hooks call
  test/fake-figcraft.mjs             fake FigCraft MCP server for unit tests
  test/figcraft-contract.real.test.ts  the real FigCraft test (skipped without binaries)
  client/designs-panel.tsx           list, new, rename, remove, out-of-step marks
  client/editor-view.tsx             web: iframe; native: image view + comments
  client/send-sheet.tsx              Send to agent: agent chips + note
  client/styles.ts                   styles from the host theme
docker/figcraft/Dockerfile           server + web build + Caddy, pinned, checksummed
docker/figcraft/Caddyfile            /app/ static, everything else to figcraft-server
docker/figcraft/server.toml          listen, data, public_url, web_url, trusted_proxy
docker/docker-compose.figcraft.yml   the Dokploy compose for the figcraft stack
```

Modified: `docker/Dockerfile.agents` (pinned `figcraft-cli`), `docker/docker-compose.yml` and `docker/docker-compose.vpn.yml` (FigCraft env), `.github/workflows/docker.yml` (publish the figcraft image), `.github/workflows/fork-ci.yml` (the real FigCraft test), `packages/server/src/server/plugins/builtin/index.ts` (list `design`), `docs/plugins.md`, `docs/docker.md`.

---

### Task 1: The real FigCraft contract, measured first

Everything after this rests on FigCraft's behaviour at v0.18.1. This task pins it in one test that runs against the real binaries, here (linux-aarch64) and in CI (linux-x64). Later tasks copy the exact shapes it records into the fake.

**Files:**

- Create: `plugins/design/test/figcraft-contract.real.test.ts`
- Create: `plugins/design/test/install-figcraft.sh`
- Create: `plugins/design/test/README.md`

**Interfaces:**

- Produces: the measured shapes, written as fixtures under `plugins/design/test/fixtures/` (`peers.json`, `publish.json`, `variable-export.json`, `comment-list.json`, `inspect-code.json`), used by Task 5's fake.

- [ ] **Step 1: Write the installer script**

```bash
#!/usr/bin/env bash
# Downloads the pinned FigCraft CLI and server for this machine into $1 (default /tmp/figcraft),
# checked against the release's SHA256SUMS.txt. Used by the real contract test and CI.
set -euo pipefail
VERSION="${FIGCRAFT_VERSION:-0.18.1}"
DEST="${1:-/tmp/figcraft}"
case "$(uname -m)" in
  aarch64|arm64) ARCH=aarch64 ;;
  x86_64|amd64) ARCH=x86_64 ;;
  *) echo "unsupported arch $(uname -m)" >&2; exit 1 ;;
esac
BASE="https://github.com/storytold/figcraft/releases/download/v${VERSION}"
APP="figcraft-${VERSION}-linux-${ARCH}.tar.gz"
SERVER="figcraft-server-${VERSION}-linux-${ARCH}.tar.gz"
mkdir -p "$DEST"
cd "$DEST"
curl -fsSL -o SHA256SUMS.txt "$BASE/SHA256SUMS.txt"
for asset in "$APP" "$SERVER"; do
  [ -f "$asset" ] || curl -fsSL -o "$asset" "$BASE/$asset"
  grep " ${asset}\$" SHA256SUMS.txt | sha256sum -c -
done
tar xzf "$APP"
tar xzf "$SERVER"
CLI="$(find "$DEST" -path '*/bin/figcraft-cli' -type f | head -1)"
SRV="$(find "$DEST" -name figcraft-server -type f | head -1)"
chmod +x "$CLI" "$SRV"
echo "FIGCRAFT_CLI=$CLI"
echo "FIGCRAFT_SERVER_BIN=$SRV"
```

- [ ] **Step 2: Run it here and note the two paths**

Run: `bash plugins/design/test/install-figcraft.sh /tmp/figcraft`
Expected: two `OK` lines from `sha256sum -c`, then `FIGCRAFT_CLI=...` and `FIGCRAFT_SERVER_BIN=...`.

- [ ] **Step 3: Write the contract test**

The test starts a real `figcraft-server` on a free loopback port with a temp data dir, reads its key with `figcraft-server --data <dir> key`, and drives two headless `figcraft-cli mcp` processes over stdio with a tiny inline JSON-RPC helper (no plugin code yet). It records each answer under `test/fixtures/` when `FIGCRAFT_RECORD=1`.

```ts
import { spawn, execFileSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const CLI = process.env.FIGCRAFT_CLI;
const SERVER_BIN = process.env.FIGCRAFT_SERVER_BIN;
const RECORD = process.env.FIGCRAFT_RECORD === "1";
const FIXTURES = new URL("./fixtures/", import.meta.url);

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      probe.close(() => resolve(typeof address === "object" && address ? address.port : 0));
    });
  });
}

class Mcp {
  private nextId = 1;
  private readonly waiting = new Map<
    number,
    (message: { result?: unknown; error?: { message: string } }) => void
  >();
  constructor(private readonly child: ChildProcessWithoutNullStreams) {
    createInterface({ input: child.stdout }).on("line", (line) => {
      const message = JSON.parse(line) as {
        id?: number;
        result?: unknown;
        error?: { message: string };
      };
      if (typeof message.id === "number") this.waiting.get(message.id)?.(message);
    });
  }
  static async start(cli: string, home: string): Promise<Mcp> {
    const child = spawn(cli, ["mcp"], { env: { ...process.env, HOME: home }, stdio: "pipe" });
    const mcp = new Mcp(child);
    await mcp.request("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "contract", version: "1" },
    });
    child.stdin.write(
      `${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`,
    );
    return mcp;
  }
  request(method: string, params: unknown): Promise<unknown> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.waiting.set(id, (message) =>
        message.error ? reject(new Error(message.error.message)) : resolve(message.result),
      );
      this.child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    });
  }
  /** tools/call; returns the parsed JSON of the first text part. */
  async tool(name: string, args: Record<string, unknown>): Promise<unknown> {
    const result = (await this.request("tools/call", { name, arguments: args })) as {
      content?: { type: string; text?: string }[];
      isError?: boolean;
    };
    const text = result.content?.find((part) => part.type === "text")?.text ?? "";
    if (result.isError) throw new Error(text);
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }
  command(command: string, params: Record<string, unknown> = {}): Promise<unknown> {
    return this.tool("run_command", { command, params });
  }
  stop(): void {
    this.child.kill("SIGTERM");
  }
}

function record(name: string, value: unknown): void {
  if (!RECORD) return;
  mkdirSync(FIXTURES, { recursive: true });
  writeFileSync(new URL(name, FIXTURES), `${JSON.stringify(value, null, 2)}\n`);
}

async function until<T>(read: () => Promise<T>, done: (value: T) => boolean): Promise<T> {
  for (let i = 0; i < 100; i++) {
    const value = await read();
    if (done(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error("timed out");
}

describe.skipIf(!CLI || !SERVER_BIN)("FigCraft v0.18.1 contract", () => {
  let server: ChildProcessWithoutNullStreams;
  let address = "";
  let key = "";
  let a: Mcp;
  let b: Mcp;

  beforeAll(async () => {
    const data = mkdtempSync(join(tmpdir(), "figcraft-data-"));
    const port = await freePort();
    const config = join(data, "server.toml");
    writeFileSync(config, `listen = "127.0.0.1:${port}"\ndata = "${data}"\n`);
    server = spawn(SERVER_BIN!, ["--config", config], { stdio: "pipe" });
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const keyLine = execFileSync(SERVER_BIN!, ["--config", config, "key"], { encoding: "utf8" });
    const match = /key=([^\s&]+)/.exec(keyLine);
    if (!match) throw new Error(`no key in: ${keyLine.length} chars`);
    key = match[1];
    address = `ws://127.0.0.1:${port}/`;
    a = await Mcp.start(CLI!, mkdtempSync(join(tmpdir(), "figcraft-a-")));
    b = await Mcp.start(CLI!, mkdtempSync(join(tmpdir(), "figcraft-b-")));
  }, 60_000);

  afterAll(() => {
    a?.stop();
    b?.stop();
    server?.kill("SIGTERM");
  });

  it("publishes a file with the key and returns edit and view links", async () => {
    const published = await a.command("collab.publish", {
      server: `${address}?key=${key}`,
      name: "contract",
    });
    record("publish.json", published);
    const peers = await until(
      () => a.command("collab.peers") as Promise<{ status?: string }>,
      (value) => value.status === "live",
    );
    record("peers-host.json", peers);
    expect(JSON.stringify(published)).toMatch(/edit/i);
  }, 60_000);

  it("a second member joins with the edit link and sees the first one's selection", async () => {
    const peers = (await a.command("collab.peers")) as { share?: { editLink?: string } };
    const published = (await a.command("collab.peers")) as Record<string, unknown>;
    const link = peers.share?.editLink ?? (published.link as string | undefined);
    expect(typeof link).toBe("string");
    await b.command("collab.join", { link });
    await until(
      () => b.command("collab.peers") as Promise<{ status?: string }>,
      (value) => value.status === "live",
    );
    const frame = (await a.tool("create_node", {
      type: "frame",
      x: 0,
      y: 0,
      width: 320,
      height: 200,
      name: "Card",
    })) as { id: string };
    await a.tool("select", { ids: [frame.id] });
    const seen = await until(
      () =>
        b.command("collab.peers") as Promise<{ peers?: { presence?: { selection?: string[] } }[] }>,
      (value) => (value.peers ?? []).some((peer) => peer.presence?.selection?.includes(frame.id)),
    );
    record("peers.json", seen);
  }, 60_000);

  it("imports variables in the local-variables JSON and exports them back", async () => {
    const variables = {
      meta: {
        variableCollections: {
          "c:1": {
            id: "c:1",
            name: "Tokens",
            modes: [{ modeId: "m:1", name: "Default" }],
            defaultModeId: "m:1",
            variableIds: ["v:1", "v:2"],
          },
        },
        variables: {
          "v:1": {
            id: "v:1",
            name: "color/accent",
            variableCollectionId: "c:1",
            resolvedType: "COLOR",
            valuesByMode: { "m:1": { r: 0.2, g: 0.4, b: 0.8, a: 1 } },
          },
          "v:2": {
            id: "v:2",
            name: "space/4",
            variableCollectionId: "c:1",
            resolvedType: "FLOAT",
            valuesByMode: { "m:1": 16 },
          },
        },
      },
    };
    const imported = await a.command("variable.import", { variables });
    record("variable-import.json", imported);
    const exported = await a.command("variable.export", { format: "json" });
    record("variable-export.json", exported);
    expect(JSON.stringify(exported)).toContain("color/accent");
  }, 60_000);

  it("lists comments, exports code and renders a picture", async () => {
    const doc = (await a.tool("inspect_document", { depth: 1 })) as Record<string, unknown>;
    record("inspect-document.json", doc);
    await a.command("comment.add", { x: 10, y: 10, text: "Make it rounder" });
    const comments = await a.command("comment.list", { page: "all", filter: "open" });
    record("comment-list.json", comments);
    const page = JSON.stringify(doc);
    const id = /"id":"([^"]+)","name":"Card"/.exec(page)?.[1];
    expect(id).toBeTruthy();
    const code = await a.command("inspect.code", { id, language: "tailwind" });
    record("inspect-code.json", code);
    const shot = await a.request("tools/call", { name: "screenshot", arguments: { maxSize: 400 } });
    record("screenshot-shape.json", {
      parts: ((shot as { content: { type: string; mimeType?: string }[] }).content ?? []).map(
        (part) => ({
          type: part.type,
          mimeType: part.mimeType,
        }),
      ),
    });
    expect(JSON.stringify(shot)).toMatch(/image/);
  }, 60_000);

  it("records codeConnect.export for a component (for the deferred unmapped-components mark)", async () => {
    const doc = JSON.stringify(await a.tool("inspect_document", { depth: 1 }));
    const id = /"id":"([^"]+)","name":"Card"/.exec(doc)?.[1];
    await a.tool("select", { ids: [id] });
    await a.command("component.create");
    const exported = await a.command("codeConnect.export", {});
    record("codeconnect.json", exported);
    expect(exported).toBeDefined();
  }, 60_000);
});
```

- [ ] **Step 4: Run it against the real binaries and record**

Run (fill the two paths from Step 2):
`cd /workspace/utils/paseo && FIGCRAFT_RECORD=1 FIGCRAFT_CLI=<cli> FIGCRAFT_SERVER_BIN=<server> flock -w 480 /tmp/paseo-heavy.lock npx vitest run plugins/design/test/figcraft-contract.real.test.ts --bail=1`
Expected: 5 tests pass and `plugins/design/test/fixtures/*.json` exist.

If a step fails because a field is named differently, read the recorded or printed answer, change only the test's field access to what FigCraft returns, and rerun. Note every such difference in `plugins/design/test/README.md` under "Measured differences from the docs". These fixtures, not the docs, are the contract for later tasks. Before committing, open each fixture and replace any `key=`, `token=`, edit-link or owner-token value with `"<redacted>"` (`grep -rn "key=\|token=" plugins/design/test/fixtures` must print nothing).

- [ ] **Step 5: Write the README**

`plugins/design/test/README.md`: how to run the real test (`install-figcraft.sh`, the two env vars, `FIGCRAFT_RECORD=1` to refresh fixtures), that the test is skipped without the env vars, and the "Measured differences from the docs" list from Step 4 (write "None" when there were none).

- [ ] **Step 6: Run it without the env vars (skipped) and commit**

Run: `flock -w 480 /tmp/paseo-heavy.lock npx vitest run plugins/design/test/figcraft-contract.real.test.ts`
Expected: the suite is skipped, exit 0.

```bash
npm run format:files -- plugins/design/test
env LEFTHOOK=0 GIT_AUTHOR_NAME=tatsuya GIT_AUTHOR_EMAIL=allrested@gmail.com GIT_COMMITTER_NAME=tatsuya GIT_COMMITTER_EMAIL=allrested@gmail.com \
  git commit -m "test(fork): measure FigCraft 0.18.1's session, variables, comments and code contract" -- plugins/design/test
```

(`git add plugins/design/test` first: the files are new.)

---

### Task 2: Plugin scaffold, config and paths

**Files:**

- Create: `plugins/design/paseo-plugin.json`
- Create: `plugins/design/shared/config.ts`, `plugins/design/shared/config.test.ts`
- Create: `plugins/design/server/paths.ts`, `plugins/design/server/paths.test.ts`
- Create: `plugins/design/index.server.ts` (empty plugin for now), `plugins/design/index.client.tsx` (nothing contributed yet)
- Modify: `packages/server/src/server/plugins/builtin/index.ts` (add `"design"` after `"default-skills"`)

**Interfaces:**

- Produces: `readDesignConfig(env): DesignConfig | { disabled: string }`, `interface DesignConfig { serverUrl: string; webUrl: string; serverKey: string; cliPath: string; maxBridges: number }`, `designPaths(env, home): { filesJson: string; scratchRoot: string; runDir: string }`, `scratchDir(paths, projectKey): string`.

- [ ] **Step 1: Manifest**

```json
{ "id": "design", "requirements": { "paseo": ">=0.16.0" } }
```

- [ ] **Step 2: Failing config tests**

```ts
import { describe, expect, it } from "vitest";
import { readDesignConfig } from "./config.js";

const full = {
  FIGCRAFT_URL: "wss://figcraft.dev.mtapp.dev/",
  FIGCRAFT_WEB_URL: "https://figcraft.dev.mtapp.dev/app/",
  FIGCRAFT_SERVER_KEY: "k",
};

describe("readDesignConfig", () => {
  it("reads the server, web build, key, CLI and cap", () => {
    expect(
      readDesignConfig({ ...full, FIGCRAFT_CLI: "/opt/figcraft-cli", DESIGN_MAX_BRIDGES: "2" }),
    ).toEqual({
      serverUrl: "wss://figcraft.dev.mtapp.dev/",
      webUrl: "https://figcraft.dev.mtapp.dev/app/",
      serverKey: "k",
      cliPath: "/opt/figcraft-cli",
      maxBridges: 2,
    });
  });
  it("defaults the CLI to figcraft-cli on PATH and the cap to 3", () => {
    expect(readDesignConfig(full)).toMatchObject({ cliPath: "figcraft-cli", maxBridges: 3 });
  });
  it("is off without a server or key, and says which", () => {
    expect(readDesignConfig({})).toEqual({ disabled: "FIGCRAFT_URL is not set on this host" });
    expect(readDesignConfig({ FIGCRAFT_URL: full.FIGCRAFT_URL })).toEqual({
      disabled: "FIGCRAFT_SERVER_KEY is not set on this host",
    });
  });
  it("refuses FigCraft's public server", () => {
    expect(readDesignConfig({ ...full, FIGCRAFT_URL: "wss://collab.craftapps.dev/" })).toEqual({
      disabled: "FIGCRAFT_URL names FigCraft's public server; design mode uses your own",
    });
  });
  it("derives the web build from the server when FIGCRAFT_WEB_URL is absent", () => {
    const { FIGCRAFT_WEB_URL: _, ...rest } = full;
    expect(readDesignConfig(rest)).toMatchObject({ webUrl: "https://figcraft.dev.mtapp.dev/app/" });
  });
});
```

- [ ] **Step 3: Run, see them fail**

Run: `flock -w 480 /tmp/paseo-heavy.lock npx vitest run plugins/design/shared/config.test.ts --bail=1`
Expected: FAIL, `Cannot find module './config.js'`.

- [ ] **Step 4: Implement**

```ts
export interface DesignConfig {
  /** wss:// address of our figcraft-server, without a query. */
  serverUrl: string;
  /** Where the browser build is served, ending in a slash. */
  webUrl: string;
  /** Publishes and manages files. Never leaves the daemon. */
  serverKey: string;
  cliPath: string;
  maxBridges: number;
}

const PUBLIC_SERVER = "collab.craftapps.dev";

function webUrlFor(serverUrl: string): string {
  const url = new URL(serverUrl);
  url.protocol = url.protocol === "ws:" ? "http:" : "https:";
  url.pathname = "/app/";
  url.search = "";
  return url.toString();
}

/** Built-ins run in the daemon, so `env` is the daemon's env. */
export function readDesignConfig(env: NodeJS.ProcessEnv): DesignConfig | { disabled: string } {
  const serverUrl = env.FIGCRAFT_URL?.trim();
  if (!serverUrl) return { disabled: "FIGCRAFT_URL is not set on this host" };
  if (new URL(serverUrl).host === PUBLIC_SERVER) {
    return { disabled: "FIGCRAFT_URL names FigCraft's public server; design mode uses your own" };
  }
  const serverKey = env.FIGCRAFT_SERVER_KEY?.trim();
  if (!serverKey) return { disabled: "FIGCRAFT_SERVER_KEY is not set on this host" };
  const cap = Number.parseInt(env.DESIGN_MAX_BRIDGES ?? "", 10);
  return {
    serverUrl,
    webUrl: env.FIGCRAFT_WEB_URL?.trim() || webUrlFor(serverUrl),
    serverKey,
    cliPath: env.FIGCRAFT_CLI?.trim() || "figcraft-cli",
    maxBridges: Number.isInteger(cap) && cap > 0 ? cap : 3,
  };
}
```

- [ ] **Step 5: Paths, test first**

`server/paths.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { designPaths, scratchDir } from "./paths.js";

describe("designPaths", () => {
  it("lives under PASEO_HOME, else ~/.paseo", () => {
    expect(designPaths({ PASEO_HOME: "/h" }, "/home/u")).toEqual({
      filesJson: "/h/design/files.json",
      scratchRoot: "/h/design/scratch",
      runDir: "/h/design/run",
    });
    expect(designPaths({}, "/home/u").filesJson).toBe("/home/u/.paseo/design/files.json");
  });
  it("gives each project its own scratch folder, with a safe name", () => {
    const paths = designPaths({ PASEO_HOME: "/h" }, "/home/u");
    expect(scratchDir(paths, "proj/../x")).toBe("/h/design/scratch/proj_.._x");
  });
});
```

`server/paths.ts`:

```ts
import { join } from "node:path";

export interface DesignPaths {
  filesJson: string;
  scratchRoot: string;
  runDir: string;
}

export function designPaths(env: NodeJS.ProcessEnv, home: string): DesignPaths {
  const root = join(env.PASEO_HOME?.trim() || join(home, ".paseo"), "design");
  return {
    filesJson: join(root, "files.json"),
    scratchRoot: join(root, "scratch"),
    runDir: join(root, "run"),
  };
}

/** FigCraft's write root for one project. Slashes become underscores so a key is one folder. */
export function scratchDir(paths: DesignPaths, projectKey: string): string {
  return join(paths.scratchRoot, projectKey.replace(/[/\\]/g, "_"));
}
```

- [ ] **Step 6: Empty entries and the built-in list**

`index.server.ts`:

```ts
import type { PluginServerContext } from "@getpaseo/plugin/server";

export default function contribute(_server: PluginServerContext): () => Promise<void> {
  return async () => {};
}
```

`index.client.tsx`:

```tsx
import type { PluginClientContext } from "@getpaseo/plugin/client";

export default function contribute(_client: PluginClientContext) {
  return () => {};
}
```

In `packages/server/src/server/plugins/builtin/index.ts`, add `"design",` after `"default-skills",`.

- [ ] **Step 7: Run tests, the built-in manifest test, typecheck, commit**

Run: `flock -w 480 /tmp/paseo-heavy.lock npx vitest run plugins/design/shared/config.test.ts plugins/design/server/paths.test.ts --bail=1` → PASS (7 tests).
Run: `flock -w 480 /tmp/paseo-heavy.lock npx vitest run packages/server/src/server/plugins/builtin/index.test.ts -t "listed built-ins resolve to matching manifests" --bail=1` → PASS.
Run: the plugins typecheck from Global Constraints → exit 0.

```bash
git add plugins/design/paseo-plugin.json plugins/design/index.server.ts plugins/design/index.client.tsx plugins/design/shared plugins/design/server/paths.ts plugins/design/server/paths.test.ts
npm run format:files -- plugins/design packages/server/src/server/plugins/builtin/index.ts
env LEFTHOOK=0 GIT_AUTHOR_NAME=tatsuya GIT_AUTHOR_EMAIL=allrested@gmail.com GIT_COMMITTER_NAME=tatsuya GIT_COMMITTER_EMAIL=allrested@gmail.com \
  git commit -m "feat(fork): scaffold the design built-in with its config and paths" -- plugins/design packages/server/src/server/plugins/builtin/index.ts
```

---

### Task 3: Tokens conversion

Pure functions between the W3C design-token file and FigCraft's local-variables JSON (the shape Task 1 recorded in `variable-export.json`; if it differs from the code below, follow the fixture).

**Files:**

- Create: `plugins/design/server/tokens.ts`, `plugins/design/server/tokens.test.ts`

**Interfaces:**

- Produces:
  - `type TokenFile = Record<string, unknown>` (the parsed W3C file)
  - `toVariables(file: TokenFile): { variables: FigVariablesJson; warnings: string[] }`
  - `fromVariables(exported: unknown, previous: TokenFile): TokenFile` (merges values back, keeps composite and unknown entries untouched)
  - `sameTokens(file: TokenFile, exported: unknown): boolean`
  - `class TokensError extends Error`

- [ ] **Step 1: Failing tests**

```ts
import { describe, expect, it } from "vitest";
import { fromVariables, sameTokens, toVariables, TokensError } from "./tokens.js";

const file = {
  color: {
    $type: "color",
    accent: { $value: "#3366cc" },
    muted: { $value: "#33669980" },
    link: { $value: "{color.accent}" },
  },
  space: { "4": { $value: "16px", $type: "dimension" } },
  font: {
    body: { $value: "Inter", $type: "fontFamily" },
    weight: { $value: 500, $type: "fontWeight" },
  },
  shadow: {
    card: {
      $type: "shadow",
      $value: { color: "#000", offsetX: "0px", offsetY: "1px", blur: "2px", spread: "0px" },
    },
  },
};

describe("toVariables", () => {
  it("makes one collection Tokens with one mode Default and a variable per simple token", () => {
    const { variables, warnings } = toVariables(file);
    const meta = variables.meta;
    expect(Object.values(meta.variableCollections)).toEqual([
      expect.objectContaining({
        name: "Tokens",
        modes: [{ modeId: "m:default", name: "Default" }],
      }),
    ]);
    const byName = Object.fromEntries(Object.values(meta.variables).map((v) => [v.name, v]));
    expect(byName["color/accent"]).toMatchObject({
      resolvedType: "COLOR",
      valuesByMode: { "m:default": { r: 0.2, g: 0.4, b: 0.8, a: 1 } },
    });
    expect(byName["color/muted"].valuesByMode["m:default"]).toEqual({
      r: 0.2,
      g: 0.4,
      b: 0.6,
      a: 128 / 255,
    });
    expect(byName["color/link"].valuesByMode["m:default"]).toEqual({
      type: "VARIABLE_ALIAS",
      id: byName["color/accent"].id,
    });
    expect(byName["space/4"]).toMatchObject({
      resolvedType: "FLOAT",
      valuesByMode: { "m:default": 16 },
    });
    expect(byName["font/body"]).toMatchObject({
      resolvedType: "STRING",
      valuesByMode: { "m:default": "Inter" },
    });
    expect(byName["font/weight"]).toMatchObject({
      resolvedType: "FLOAT",
      valuesByMode: { "m:default": 500 },
    });
    expect(byName["shadow/card"]).toBeUndefined();
    expect(warnings).toEqual(["shadow.card: shadow tokens stay in the file and are not imported"]);
  });
  it("inherits $type from a group and refuses a token with no type", () => {
    expect(() => toVariables({ x: { $value: "#fff" } })).toThrow(
      new TokensError("x: no $type on the token or its groups"),
    );
  });
  it("refuses an alias to a token that does not exist", () => {
    expect(() => toVariables({ color: { $type: "color", a: { $value: "{color.b}" } } })).toThrow(
      new TokensError("color.a: alias {color.b} names no token"),
    );
  });
  it("refuses a dimension that is not px", () => {
    expect(() => toVariables({ s: { $type: "dimension", $value: "1rem" } })).toThrow(
      new TokensError("s: only px dimensions are supported, got 1rem"),
    );
  });
});

describe("fromVariables and sameTokens", () => {
  it("writes changed values back in the file's own form and keeps the rest", () => {
    const { variables } = toVariables(file);
    const exported = structuredClone(variables);
    const accent = Object.values(exported.meta.variables).find((v) => v.name === "color/accent")!;
    accent.valuesByMode["m:default"] = { r: 1, g: 0, b: 0, a: 1 };
    const space = Object.values(exported.meta.variables).find((v) => v.name === "space/4")!;
    space.valuesByMode["m:default"] = 20;
    const next = fromVariables(exported, file);
    expect(next.color).toMatchObject({
      accent: { $value: "#ff0000" },
      link: { $value: "{color.accent}" },
    });
    expect(next.space).toEqual({ "4": { $value: "20px", $type: "dimension" } });
    expect(next.shadow).toEqual(file.shadow);
    expect(sameTokens(file, exported)).toBe(false);
    expect(sameTokens(next, exported)).toBe(true);
  });
  it("adds a token FigCraft gained, under its slash path, typed", () => {
    const { variables } = toVariables(file);
    const exported = structuredClone(variables);
    exported.meta.variables["v:new"] = {
      id: "v:new",
      name: "radius/card",
      variableCollectionId: Object.keys(exported.meta.variableCollections)[0],
      resolvedType: "FLOAT",
      valuesByMode: { "m:default": 12 },
    };
    expect(fromVariables(exported, file).radius).toEqual({ card: { $value: 12, $type: "number" } });
  });
  it("reads only the Tokens collection's default mode", () => {
    expect(sameTokens(file, { meta: { variableCollections: {}, variables: {} } })).toBe(false);
  });
});
```

- [ ] **Step 2: Run, see them fail**

Run: `flock -w 480 /tmp/paseo-heavy.lock npx vitest run plugins/design/server/tokens.test.ts --bail=1` → FAIL, module not found.

- [ ] **Step 3: Implement**

```ts
// W3C design tokens (https://design-tokens.github.io/community-group/format/) <-> FigCraft's
// local-variables JSON (the Figma REST shape FigCraft reads and writes; see the Task 1 fixtures).
// One collection "Tokens", one mode "Default". Composite types stay in the file, not imported.

export type TokenFile = Record<string, unknown>;

type Rgba = { r: number; g: number; b: number; a: number };
type Alias = { type: "VARIABLE_ALIAS"; id: string };
type FigValue = Rgba | number | string | boolean | Alias;

export interface FigVariable {
  id: string;
  name: string;
  variableCollectionId: string;
  resolvedType: "COLOR" | "FLOAT" | "STRING" | "BOOLEAN";
  valuesByMode: Record<string, FigValue>;
}

export interface FigVariablesJson {
  meta: {
    variableCollections: Record<
      string,
      {
        id: string;
        name: string;
        modes: { modeId: string; name: string }[];
        defaultModeId: string;
        variableIds: string[];
      }
    >;
    variables: Record<string, FigVariable>;
  };
}

export class TokensError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TokensError";
  }
}

const COLLECTION = "c:tokens";
const MODE = "m:default";
const COMPOSITE = new Set([
  "shadow",
  "typography",
  "border",
  "transition",
  "gradient",
  "strokeStyle",
  "cubicBezier",
]);
const ALIAS = /^\{([^{}]+)\}$/;

interface Leaf {
  path: string[];
  type: string;
  value: unknown;
}

function isGroup(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function leaves(
  node: Record<string, unknown>,
  path: string[],
  inherited: string | undefined,
  out: Leaf[],
): void {
  const type = typeof node.$type === "string" ? node.$type : inherited;
  if ("$value" in node) {
    if (!type) throw new TokensError(`${path.join(".")}: no $type on the token or its groups`);
    out.push({ path, type, value: node.$value });
    return;
  }
  for (const [key, child] of Object.entries(node)) {
    if (key.startsWith("$") || !isGroup(child)) continue;
    leaves(child, [...path, key], type, out);
  }
}

function hexToRgba(hex: string, where: string): Rgba {
  const match = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(hex.trim());
  if (!match) throw new TokensError(`${where}: colour ${hex} is not #rgb, #rrggbb or #rrggbbaa`);
  let digits = match[1];
  if (digits.length === 3) digits = [...digits].map((c) => c + c).join("");
  const byte = (i: number) => Number.parseInt(digits.slice(i, i + 2), 16) / 255;
  return { r: byte(0), g: byte(2), b: byte(4), a: digits.length === 8 ? byte(6) : 1 };
}

function rgbaToHex({ r, g, b, a }: Rgba): string {
  const byte = (v: number) =>
    Math.round(v * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${byte(r)}${byte(g)}${byte(b)}${a < 1 ? byte(a) : ""}`;
}

function variableId(path: string[]): string {
  return `v:${path.join("/")}`;
}

function figValue(
  leaf: Leaf,
  known: Set<string>,
): { type: FigVariable["resolvedType"]; value: FigValue } {
  const where = leaf.path.join(".");
  if (typeof leaf.value === "string") {
    const alias = ALIAS.exec(leaf.value);
    if (alias) {
      const target = alias[1].split(".");
      if (!known.has(target.join(".")))
        throw new TokensError(`${where}: alias ${leaf.value} names no token`);
      return {
        type: resolvedTypeOf(leaf.type),
        value: { type: "VARIABLE_ALIAS", id: variableId(target) },
      };
    }
  }
  switch (leaf.type) {
    case "color":
      return { type: "COLOR", value: hexToRgba(String(leaf.value), where) };
    case "dimension": {
      const match = /^(-?\d+(?:\.\d+)?)px$/.exec(String(leaf.value));
      if (!match)
        throw new TokensError(
          `${where}: only px dimensions are supported, got ${String(leaf.value)}`,
        );
      return { type: "FLOAT", value: Number(match[1]) };
    }
    case "number":
    case "fontWeight":
    case "duration":
      if (typeof leaf.value !== "number")
        throw new TokensError(`${where}: ${leaf.type} must be a number`);
      return { type: "FLOAT", value: leaf.value };
    case "fontFamily":
      return {
        type: "STRING",
        value: Array.isArray(leaf.value) ? String(leaf.value[0]) : String(leaf.value),
      };
    case "boolean":
      return { type: "BOOLEAN", value: Boolean(leaf.value) };
    default:
      return { type: "STRING", value: String(leaf.value) };
  }
}

function resolvedTypeOf(type: string): FigVariable["resolvedType"] {
  if (type === "color") return "COLOR";
  if (type === "dimension" || type === "number" || type === "fontWeight" || type === "duration")
    return "FLOAT";
  if (type === "boolean") return "BOOLEAN";
  return "STRING";
}

export function toVariables(file: TokenFile): { variables: FigVariablesJson; warnings: string[] } {
  const all: Leaf[] = [];
  leaves(file, [], undefined, all);
  const warnings: string[] = [];
  const simple = all.filter((leaf) => {
    if (!COMPOSITE.has(leaf.type)) return true;
    warnings.push(
      `${leaf.path.join(".")}: ${leaf.type} tokens stay in the file and are not imported`,
    );
    return false;
  });
  const known = new Set(simple.map((leaf) => leaf.path.join(".")));
  const variables: FigVariablesJson["meta"]["variables"] = {};
  for (const leaf of simple) {
    const { type, value } = figValue(leaf, known);
    const id = variableId(leaf.path);
    variables[id] = {
      id,
      name: leaf.path.join("/"),
      variableCollectionId: COLLECTION,
      resolvedType: type,
      valuesByMode: { [MODE]: value },
    };
  }
  return {
    warnings,
    variables: {
      meta: {
        variableCollections: {
          [COLLECTION]: {
            id: COLLECTION,
            name: "Tokens",
            modes: [{ modeId: MODE, name: "Default" }],
            defaultModeId: MODE,
            variableIds: Object.keys(variables),
          },
        },
        variables,
      },
    },
  };
}

/** The Tokens collection's variables by name, each at its default mode. */
function exportedByName(
  exported: unknown,
): Map<string, { variable: FigVariable; value: FigValue; names: Map<string, string> }> {
  const meta = (exported as Partial<FigVariablesJson>)?.meta;
  const result = new Map<
    string,
    { variable: FigVariable; value: FigValue; names: Map<string, string> }
  >();
  if (!meta) return result;
  const collection = Object.values(meta.variableCollections ?? {}).find((c) => c.name === "Tokens");
  if (!collection) return result;
  const names = new Map(Object.values(meta.variables ?? {}).map((v) => [v.id, v.name]));
  for (const variable of Object.values(meta.variables ?? {})) {
    if (variable.variableCollectionId !== collection.id) continue;
    result.set(variable.name, {
      variable,
      value: variable.valuesByMode[collection.defaultModeId],
      names,
    });
  }
  return result;
}

function tokenValue(type: string, value: FigValue, names: Map<string, string>): unknown {
  if (typeof value === "object" && value !== null && "type" in value) {
    const target = names.get(value.id);
    return target ? `{${target.split("/").join(".")}}` : undefined;
  }
  if (type === "color" && typeof value === "object") return rgbaToHex(value as Rgba);
  if (type === "dimension" && typeof value === "number") return `${value}px`;
  return value;
}

function newTokenType(variable: FigVariable): string {
  return { COLOR: "color", FLOAT: "number", STRING: "string", BOOLEAN: "boolean" }[
    variable.resolvedType
  ];
}

export function fromVariables(exported: unknown, previous: TokenFile): TokenFile {
  const next = structuredClone(previous);
  const existing: Leaf[] = [];
  leaves(previous, [], undefined, existing);
  const byName = exportedByName(exported);
  const seen = new Set<string>();
  for (const leaf of existing) {
    const name = leaf.path.join("/");
    const entry = byName.get(name);
    if (!entry || COMPOSITE.has(leaf.type)) continue;
    seen.add(name);
    const value = tokenValue(leaf.type, entry.value, entry.names);
    if (value === undefined) continue;
    let node = next as Record<string, unknown>;
    for (const key of leaf.path) node = node[key] as Record<string, unknown>;
    node.$value = value;
  }
  for (const [name, entry] of byName) {
    if (seen.has(name)) continue;
    const path = name.split("/");
    const type = newTokenType(entry.variable);
    let node = next as Record<string, unknown>;
    for (const key of path.slice(0, -1)) {
      if (!isGroup(node[key])) node[key] = {};
      node = node[key] as Record<string, unknown>;
    }
    node[path[path.length - 1]] = {
      $value: tokenValue(type, entry.value, entry.names),
      $type: type,
    };
  }
  return next;
}

export function sameTokens(file: TokenFile, exported: unknown): boolean {
  return (
    JSON.stringify(fromVariables(exported, file)) === JSON.stringify(file) &&
    exportedByName(exported).size > 0
  );
}
```

- [ ] **Step 4: Run, pass**

Run: `flock -w 480 /tmp/paseo-heavy.lock npx vitest run plugins/design/server/tokens.test.ts --bail=1` → PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add plugins/design/server/tokens.ts plugins/design/server/tokens.test.ts
npm run format:files -- plugins/design/server/tokens.ts plugins/design/server/tokens.test.ts
env LEFTHOOK=0 GIT_AUTHOR_NAME=tatsuya GIT_AUTHOR_EMAIL=allrested@gmail.com GIT_COMMITTER_NAME=tatsuya GIT_COMMITTER_EMAIL=allrested@gmail.com \
  git commit -m "feat(fork): design tokens to FigCraft variables and back" -- plugins/design/server/tokens.ts plugins/design/server/tokens.test.ts
```

---

### Task 4: Files map per project

**Files:**

- Create: `plugins/design/server/files-store.ts`, `plugins/design/server/files-store.test.ts`

**Interfaces:**

- Produces:
  - `interface DesignFile { id: string; projectKey: string; name: string; createdAt: number; lastAgentId: string | null; secrets: { editLink: string; viewLink: string; ownerToken: string | null } }`
  - `interface FilesStore { list(projectKey: string): Promise<DesignFile[]>; get(id: string): Promise<DesignFile | null>; add(file: DesignFile): Promise<void>; update(id: string, patch: Partial<Pick<DesignFile, "name" | "lastAgentId">>): Promise<DesignFile>; remove(id: string): Promise<void> }`
  - `createFilesStore({ file, log }): FilesStore`
  - `publicFile(file: DesignFile): PublicDesignFile` (drops `secrets`), `type PublicDesignFile = Omit<DesignFile, "secrets">`

- [ ] **Step 1: Failing tests**

```ts
import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createFilesStore, publicFile, type DesignFile } from "./files-store.js";

function file(id: string, projectKey = "p1"): DesignFile {
  return {
    id,
    projectKey,
    name: `Design ${id}`,
    createdAt: 1,
    lastAgentId: null,
    secrets: {
      editLink: `wss://x/?file=${id}&token=e`,
      viewLink: `wss://x/?file=${id}&token=v`,
      ownerToken: "o",
    },
  };
}

function store() {
  const path = join(mkdtempSync(join(tmpdir(), "design-files-")), "design", "files.json");
  return { path, store: createFilesStore({ file: path, log: () => {} }) };
}

describe("files store", () => {
  it("adds, lists by project, renames, records the agent and removes", async () => {
    const { store: s } = store();
    await s.add(file("a"));
    await s.add(file("b", "p2"));
    expect((await s.list("p1")).map((f) => f.id)).toEqual(["a"]);
    await s.update("a", { name: "Login", lastAgentId: "agent-1" });
    expect(await s.get("a")).toMatchObject({ name: "Login", lastAgentId: "agent-1" });
    await s.remove("a");
    expect(await s.list("p1")).toEqual([]);
  });
  it("survives a restart and keeps the file private to the user", async () => {
    const { path, store: s } = store();
    await s.add(file("a"));
    const again = createFilesStore({ file: path, log: () => {} });
    expect(await again.get("a")).toEqual(file("a"));
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(JSON.parse(readFileSync(path, "utf8")).version).toBe(1);
  });
  it("rejects an update to a file it does not have", async () => {
    const { store: s } = store();
    await expect(s.update("nope", { name: "x" })).rejects.toThrow("No design file nope");
  });
  it("starts empty from a corrupt file and logs it, without the contents", async () => {
    const dir = mkdtempSync(join(tmpdir(), "design-files-"));
    const path = join(dir, "files.json");
    const { writeFileSync } = await import("node:fs");
    writeFileSync(path, "{not json token=secret");
    const lines: string[] = [];
    const s = createFilesStore({ file: path, log: (line) => lines.push(line) });
    expect(await s.list("p1")).toEqual([]);
    expect(lines.join("\n")).toContain("files.json could not be read");
    expect(lines.join("\n")).not.toContain("secret");
  });
  it("publicFile drops the links and the owner token", () => {
    expect(publicFile(file("a"))).not.toHaveProperty("secrets");
  });
});
```

- [ ] **Step 2: Run, fail** — `npx vitest run plugins/design/server/files-store.test.ts --bail=1` (with the flock prefix) → module not found.

- [ ] **Step 3: Implement**

```ts
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";

const DesignFileSchema = z.object({
  id: z.string().min(1),
  projectKey: z.string().min(1),
  name: z.string().min(1),
  createdAt: z.number(),
  lastAgentId: z.string().nullable(),
  secrets: z.object({
    editLink: z.string(),
    viewLink: z.string(),
    ownerToken: z.string().nullable(),
  }),
});
export type DesignFile = z.output<typeof DesignFileSchema>;
export type PublicDesignFile = Omit<DesignFile, "secrets">;

const StoreSchema = z.object({ version: z.literal(1), files: z.array(DesignFileSchema) });

export interface FilesStore {
  list(projectKey: string): Promise<DesignFile[]>;
  get(id: string): Promise<DesignFile | null>;
  add(file: DesignFile): Promise<void>;
  update(id: string, patch: Partial<Pick<DesignFile, "name" | "lastAgentId">>): Promise<DesignFile>;
  remove(id: string): Promise<void>;
}

export function publicFile({ secrets: _secrets, ...rest }: DesignFile): PublicDesignFile {
  return rest;
}

/** One writer: every read and write runs in order on one queue; saves are atomic (temp + rename). */
export function createFilesStore(options: { file: string; log(line: string): void }): FilesStore {
  let files: DesignFile[] | null = null;
  let queue: Promise<unknown> = Promise.resolve();

  function run<T>(work: () => Promise<T>): Promise<T> {
    const next = queue.then(work, work);
    queue = next.catch(() => undefined);
    return next;
  }

  async function load(): Promise<DesignFile[]> {
    if (files !== null) return files;
    try {
      files = StoreSchema.parse(JSON.parse(await readFile(options.file, "utf8"))).files;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        options.log(
          `[design] files.json could not be read; starting empty (${(error as Error).name})`,
        );
      }
      files = [];
    }
    return files;
  }

  async function save(next: DesignFile[]): Promise<void> {
    await mkdir(dirname(options.file), { recursive: true, mode: 0o700 });
    const temp = `${options.file}.tmp`;
    await writeFile(temp, `${JSON.stringify({ version: 1, files: next }, null, 2)}\n`, {
      mode: 0o600,
    });
    await rename(temp, options.file);
    files = next;
  }

  return {
    list: (projectKey) =>
      run(async () => (await load()).filter((f) => f.projectKey === projectKey)),
    get: (id) => run(async () => (await load()).find((f) => f.id === id) ?? null),
    add: (file) => run(async () => save([...(await load()), file])),
    update: (id, patch) =>
      run(async () => {
        const all = await load();
        const current = all.find((f) => f.id === id);
        if (!current) throw new Error(`No design file ${id}`);
        const updated = { ...current, ...patch };
        await save(all.map((f) => (f.id === id ? updated : f)));
        return updated;
      }),
    remove: (id) => run(async () => save((await load()).filter((f) => f.id !== id))),
  };
}
```

- [ ] **Step 4: Run, pass** (5 tests). **Step 5: Commit** `feat(fork): design files map per project, private and atomic` (stage the two files, format first, commit with the fork identity as in Task 3).

---

### Task 5: MCP stdio client, FigCraft session wrapper and the fake FigCraft

**Files:**

- Create: `plugins/design/server/pid-files.ts` (copy of `plugins/resource-manager/server/pid-files.ts`, unchanged)
- Create: `plugins/design/server/mcp-stdio-client.ts` (copy of `plugins/resource-manager/server/remote/mcp-stdio-client.ts`, adapted in Step 1)
- Create: `plugins/design/test/fake-figcraft.mjs`
- Create: `plugins/design/server/figcraft-session.ts`, `plugins/design/server/figcraft-session.test.ts`

**Interfaces:**

- Consumes: Task 1 fixtures.
- Produces:
  - `startMcpStdioClient(command: { command: string; args: readonly string[]; env: Record<string, string> }, options: { runDir: string; name: string; procRoot: string; baseEnv: NodeJS.ProcessEnv; startTimeoutMs: number; requestTimeoutMs: number }): Promise<McpStdioClient>` (the copied function, unchanged signature) and `McpStdioClient.callToolRaw(name, args): Promise<{ isError: boolean; text: string; images: { mimeType: string; data: string }[] }>`, `McpStdioClient.close(): Promise<void>`, `McpStdioClient.closed: boolean`, `onExit(listener: (reason: string) => void): void`.
  - `class FigcraftSession` with `static start(options: SessionStartOptions): Promise<FigcraftSession>` and methods `publish(serverWithKey, name): Promise<{ editLink: string; viewLink: string; ownerToken: string | null }>`, `join(link): Promise<void>`, `peers(): Promise<PeersState>`, `importVariables(json): Promise<{ warnings: string[] }>`, `exportVariables(): Promise<unknown>`, `comments(): Promise<CommentThread[]>`, `addComment(x, y, text): Promise<string>`, `commentPrompt(ids): Promise<string>`, `code(id): Promise<string>`, `screenshot(ids?: string[], maxSize?: number): Promise<{ mimeType: string; data: string }>`, `pageBounds(): Promise<{ x: number; y: number; width: number; height: number } | null>`, `close(): Promise<void>`, `onExit(listener)`.
  - `interface PeersState { status: string; peers: { id: string; name: string; selection: string[] }[] }`, `interface CommentThread { id: string; status: "open" | "resolved"; author: string; agent: boolean; preview: string }`.

- [ ] **Step 1: Copy and adapt the client**

```bash
cp plugins/resource-manager/server/pid-files.ts plugins/design/server/pid-files.ts
cp plugins/resource-manager/server/remote/mcp-stdio-client.ts plugins/design/server/mcp-stdio-client.ts
```

Edit `plugins/design/server/mcp-stdio-client.ts`:

1. Import from `./pid-files.js` instead of `../pid-files.js`.
2. `CLIENT_INFO` becomes `{ name: "paseo-design", version: "1.0.0" }`.
3. Replace every user-facing `ssh-mcp` in error messages and comments with `figcraft-cli`, and the console prefix `resource-manager:` with `design:`.
4. Add a raw tool call that keeps image parts (FigCraft's `screenshot` answers with an `image` part). Next to the existing `CallToolResultSchema`:

```ts
const CallToolRawSchema = z.object({
  content: z
    .array(
      z.object({
        type: z.string(),
        text: z.string().optional(),
        data: z.string().optional(),
        mimeType: z.string().optional(),
      }),
    )
    .optional(),
  isError: z.boolean().optional(),
});

export interface ToolCallRaw {
  isError: boolean;
  text: string;
  images: { mimeType: string; data: string }[];
}
```

and a method on `McpStdioClient`:

```ts
  async callToolRaw(name: string, args: Record<string, unknown>): Promise<ToolCallRaw> {
    const raw = await this.call("tools/call", { name, arguments: args }, this.requestTimeoutMs);
    const parsed = CallToolRawSchema.safeParse(raw);
    if (!parsed.success) throw new McpSessionError(`figcraft-cli answered ${name} with an unexpected result`);
    const parts = parsed.data.content ?? [];
    return {
      isError: parsed.data.isError === true,
      text: parts.filter((p) => p.type === "text").map((p) => p.text ?? "").join("\n"),
      images: parts.flatMap((p) => (p.type === "image" && p.data ? [{ mimeType: p.mimeType ?? "image/png", data: p.data }] : [])),
    };
  }

  onExit(listener: (reason: string) => void): void {
    this.child.once("exit", (code, signal) => listener(signal ? `stopped by ${signal}` : `exited with ${code}`));
  }
```

Keep the copied `startMcpStdioClient(command, options, signal?)` and its pid-file handling unchanged.

- [ ] **Step 2: The fake FigCraft**

`plugins/design/test/fake-figcraft.mjs` speaks newline JSON-RPC like `figcraft-cli mcp` and answers with the Task 1 fixtures. State lives in memory; the test controls it through env vars.

```js
#!/usr/bin/env node
// A stand-in for `figcraft-cli mcp` in unit tests. Answers from the fixtures that the real
// contract test recorded. FAKE_FIGCRAFT_LOG (a file) receives one JSON line per tools/call.
// FAKE_FIGCRAFT_CRASH_AFTER=n exits with code 3 after n tools/calls.
import { appendFileSync, readFileSync } from "node:fs";
import { createInterface } from "node:readline";

const fixtures = new URL("./fixtures/", import.meta.url);
const fixture = (name) => JSON.parse(readFileSync(new URL(name, fixtures), "utf8"));
const log = process.env.FAKE_FIGCRAFT_LOG;
const crashAfter = Number(process.env.FAKE_FIGCRAFT_CRASH_AFTER ?? "0");
let calls = 0;
let variables = { meta: { variableCollections: {}, variables: {} } };
let selection = [];
const comments = [];
const PNG_1PX =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

function reply(id, result) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, result })}\n`);
}
const text = (value) => ({ content: [{ type: "text", text: JSON.stringify(value) }] });

function command(name, params) {
  switch (name) {
    case "collab.publish":
      return fixture("publish.json");
    case "collab.join":
      return { session: "s1", status: "connecting" };
    case "collab.peers": {
      const peers = fixture("peers.json");
      if (process.env.FAKE_FIGCRAFT_SELECTION)
        selection = process.env.FAKE_FIGCRAFT_SELECTION.split(",");
      return {
        ...peers,
        status: "live",
        peers: [{ id: "u1", name: "You", presence: { selection } }],
      };
    }
    case "variable.import":
      variables =
        typeof params.variables === "string" ? JSON.parse(params.variables) : params.variables;
      return {
        collections: 1,
        variables: Object.keys(variables.meta.variables).length,
        updated: 0,
        warnings: [],
      };
    case "variable.export":
      return variables;
    case "comment.add":
      comments.push({
        id: `c${comments.length + 1}`,
        status: "open",
        author: "You",
        agent: false,
        preview: params.text,
      });
      return { id: `c${comments.length}`, link: "figcraft://comment" };
    case "comment.list":
      return {
        comments: process.env.FAKE_FIGCRAFT_COMMENTS
          ? JSON.parse(process.env.FAKE_FIGCRAFT_COMMENTS)
          : comments,
      };
    case "comment.prompt":
      return {
        count: (params.ids ?? []).length,
        truncated: false,
        text: `Fix: ${(params.ids ?? []).join(",")}`,
        comments: [],
      };
    case "inspect.code":
      return { code: `<div className="p-4">${params.id}</div>` };
    default:
      return { ok: true };
  }
}

createInterface({ input: process.stdin }).on("line", (line) => {
  const message = JSON.parse(line);
  if (message.method === "initialize")
    return reply(message.id, {
      protocolVersion: "2025-06-18",
      capabilities: { tools: {} },
      serverInfo: { name: "fake-figcraft", version: "0" },
    });
  if (message.method === "tools/list")
    return reply(message.id, { tools: [{ name: "run_command" }, { name: "screenshot" }] });
  if (message.method !== "tools/call")
    return message.id === undefined ? undefined : reply(message.id, {});
  calls += 1;
  if (log) appendFileSync(log, `${JSON.stringify(message.params)}\n`);
  if (crashAfter > 0 && calls > crashAfter) process.exit(3);
  const { name, arguments: args } = message.params;
  if (name === "screenshot")
    return reply(message.id, {
      content: [{ type: "image", mimeType: "image/png", data: PNG_1PX }],
    });
  if (name === "inspect_document")
    return reply(
      message.id,
      text({ pages: [{ id: "p1", bounds: { x: 0, y: 0, width: 320, height: 200 } }] }),
    );
  if (name === "run_command")
    return reply(message.id, text(command(args.command, args.params ?? {})));
  return reply(message.id, text({ ok: true }));
});
```

If Task 1 recorded different field names (for example `peers[].presence.selection` nested differently, or `publish.json` holding links under another key), make the fake return the recorded shape and make Step 4's parsing follow it.

- [ ] **Step 3: Failing session tests**

```ts
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FigcraftSession } from "./figcraft-session.js";

const FAKE = new URL("../test/fake-figcraft.mjs", import.meta.url).pathname;

async function session(env: Record<string, string> = {}) {
  const dir = mkdtempSync(join(tmpdir(), "design-session-"));
  const logFile = join(dir, "calls.log");
  const s = await FigcraftSession.start({
    command: process.execPath,
    args: [FAKE],
    env: { FAKE_FIGCRAFT_LOG: logFile, ...env },
    runDir: dir,
    name: "test",
  });
  const calls = () =>
    readFileSync(logFile, "utf8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  return { s, calls };
}

describe("FigcraftSession", () => {
  it("publishes with the server and key it is given, and returns the links", async () => {
    const { s, calls } = await session();
    const links = await s.publish("wss://figcraft.example/?key=K", "Login");
    expect(links.editLink).toMatch(/./);
    expect(calls()[0]).toEqual({
      name: "run_command",
      arguments: {
        command: "collab.publish",
        params: { server: "wss://figcraft.example/?key=K", name: "Login" },
      },
    });
    await s.close();
  });
  it("reads every member's selection", async () => {
    const { s } = await session({ FAKE_FIGCRAFT_SELECTION: "n1,n2" });
    expect((await s.peers()).peers).toEqual([{ id: "u1", name: "You", selection: ["n1", "n2"] }]);
    await s.close();
  });
  it("imports variables and exports them back", async () => {
    const { s } = await session();
    const json = { meta: { variableCollections: {}, variables: { "v:a": { id: "v:a" } } } };
    await s.importVariables(json);
    expect(await s.exportVariables()).toEqual(json);
    await s.close();
  });
  it("returns a screenshot as base64 PNG", async () => {
    const { s } = await session();
    expect(await s.screenshot(undefined, 800)).toMatchObject({ mimeType: "image/png" });
    await s.close();
  });
  it("rejects calls after close", async () => {
    const { s } = await session();
    await s.close();
    await expect(s.peers()).rejects.toThrow();
  });
});
```

- [ ] **Step 4: Implement `figcraft-session.ts`**

```ts
import { startMcpStdioClient, type McpStdioClient } from "./mcp-stdio-client.js";

export interface SessionStartOptions {
  command: string;
  args: readonly string[];
  env: Record<string, string>;
  runDir: string;
  /** Pid-file name; never a file name or link. */
  name: string;
  startTimeoutMs?: number;
  requestTimeoutMs?: number;
}

export interface PeersState {
  status: string;
  peers: { id: string; name: string; selection: string[] }[];
}

export interface CommentThread {
  id: string;
  status: "open" | "resolved";
  author: string;
  agent: boolean;
  preview: string;
}

function parseText(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** Typed FigCraft calls over one `figcraft-cli mcp` child. Every error carries FigCraft's message. */
export class FigcraftSession {
  private constructor(private readonly client: McpStdioClient) {}

  static async start(options: SessionStartOptions): Promise<FigcraftSession> {
    const client = await startMcpStdioClient(
      { command: options.command, args: options.args, env: options.env },
      {
        runDir: options.runDir,
        name: options.name,
        procRoot: "/proc",
        baseEnv: process.env,
        startTimeoutMs: options.startTimeoutMs ?? 20_000,
        requestTimeoutMs: options.requestTimeoutMs ?? 60_000,
      },
    );
    return new FigcraftSession(client);
  }

  get closed(): boolean {
    return this.client.closed;
  }

  onExit(listener: (reason: string) => void): void {
    this.client.onExit(listener);
  }

  private async tool(name: string, args: Record<string, unknown>): Promise<unknown> {
    const result = await this.client.callToolRaw(name, args);
    if (result.isError) throw new Error(result.text || `${name} failed`);
    return parseText(result.text);
  }

  private command(command: string, params: Record<string, unknown> = {}): Promise<unknown> {
    return this.tool("run_command", { command, params });
  }

  async publish(serverWithKey: string, name: string) {
    const answer = (await this.command("collab.publish", {
      server: serverWithKey,
      name,
    })) as Record<string, any>;
    const share = answer.share ?? answer.published ?? answer;
    const editLink = share.editLink ?? share.edit ?? answer.link;
    const viewLink = share.viewLink ?? share.view ?? editLink;
    if (typeof editLink !== "string")
      throw new Error("FigCraft published the file but returned no edit link");
    return {
      editLink,
      viewLink,
      ownerToken: typeof answer.ownerToken === "string" ? answer.ownerToken : null,
    };
  }

  async join(link: string): Promise<void> {
    await this.command("collab.join", { link });
    for (let i = 0; i < 50; i++) {
      const state = await this.peers();
      if (state.status === "live") return;
      if (state.status === "failed") throw new Error("FigCraft could not join the file");
      await new Promise((resolve) => setTimeout(resolve, 200).unref());
    }
    throw new Error("FigCraft did not join the file within 10 seconds");
  }

  async peers(): Promise<PeersState> {
    const answer = (await this.command("collab.peers")) as Record<string, any>;
    const peers = Array.isArray(answer.peers) ? answer.peers : [];
    return {
      status: String(answer.status ?? "unknown"),
      peers: peers.map((peer: Record<string, any>) => ({
        id: String(peer.id),
        name: String(peer.name ?? ""),
        selection: Array.isArray(peer.presence?.selection)
          ? peer.presence.selection.map(String)
          : [],
      })),
    };
  }

  async importVariables(json: unknown): Promise<{ warnings: string[] }> {
    const answer = (await this.command("variable.import", { variables: json })) as {
      warnings?: string[];
    };
    return { warnings: answer.warnings ?? [] };
  }

  exportVariables(): Promise<unknown> {
    return this.command("variable.export", { format: "json" });
  }

  async comments(): Promise<CommentThread[]> {
    const answer = (await this.command("comment.list", { page: "all", filter: "all" })) as {
      comments?: Record<string, any>[];
    };
    return (answer.comments ?? []).map((c) => ({
      id: String(c.id),
      status: c.status === "resolved" ? "resolved" : "open",
      author: String(c.author ?? ""),
      agent: c.agent === true,
      preview: String(c.preview ?? c.text ?? ""),
    }));
  }

  async addComment(x: number, y: number, text: string): Promise<string> {
    const answer = (await this.command("comment.add", { x, y, text })) as { id: string };
    return answer.id;
  }

  async commentPrompt(ids: string[]): Promise<string> {
    const answer = (await this.command("comment.prompt", { ids })) as { text: string };
    return answer.text;
  }

  async code(id: string): Promise<string> {
    const answer = (await this.command("inspect.code", { id, language: "tailwind" })) as
      | { code?: string }
      | string;
    return typeof answer === "string" ? answer : (answer.code ?? JSON.stringify(answer));
  }

  async screenshot(ids?: string[], maxSize = 1600): Promise<{ mimeType: string; data: string }> {
    const result = await this.client.callToolRaw(
      "screenshot",
      ids ? { ids, maxSize } : { maxSize },
    );
    if (result.isError || result.images.length === 0)
      throw new Error(result.text || "FigCraft returned no picture");
    return result.images[0];
  }

  /** The current page's bounds, to map a tap on the phone's picture to page coordinates. */
  async pageBounds(): Promise<{ x: number; y: number; width: number; height: number } | null> {
    const doc = (await this.tool("inspect_document", { depth: 0 })) as {
      pages?: { bounds?: { x: number; y: number; width: number; height: number } }[];
    };
    return doc.pages?.[0]?.bounds ?? null;
  }

  close(): Promise<void> {
    return this.client.close();
  }
}
```

If Task 1 showed `inspect_document` gives page bounds under another field, read that field instead; if it gives none, compute bounds as the union of the top-level layers' `x, y, width, height` from `inspect_document {depth: 1}`.

- [ ] **Step 5: Run, pass; typecheck; commit**

Run the session test file → PASS (5 tests). Run the plugins typecheck.
Commit `feat(fork): design talks to figcraft-cli over MCP, with a fake for tests` with `plugins/design/server/pid-files.ts plugins/design/server/mcp-stdio-client.ts plugins/design/server/figcraft-session.ts plugins/design/server/figcraft-session.test.ts plugins/design/test/fake-figcraft.mjs`.

---

### Task 6: The guard in front of agents' FigCraft

An agent's own `figcraft-cli mcp` could share a file to FigCraft's public server (`collab.share` defaults to it) or host one on the network. The guard is a stdio proxy that the agent's MCP config runs instead of `figcraft-cli`: it passes every line through, except a `tools/call` the policy refuses, which it answers itself with a tool error.

**Files:**

- Create: `plugins/design/bin/guard-policy.mjs`, `plugins/design/bin/guard-policy.test.ts`
- Create: `plugins/design/bin/figcraft-guard.mjs`, `plugins/design/bin/figcraft-guard.test.ts`

**Interfaces:**

- Produces: `refusal(toolName: string, args: unknown, ourServer: string): string | null` (null = allowed); the guard's command line: `node <plugin>/bin/figcraft-guard.mjs --server <wss-url> -- <figcraft-cli> mcp <args...>`.

- [ ] **Step 1: Failing policy tests**

```ts
import { describe, expect, it } from "vitest";
// @ts-expect-error plain JS module, shipped as is
import { refusal } from "./guard-policy.mjs";

const OURS = "wss://figcraft.dev.mtapp.dev/";
const run = (command: string, params: Record<string, unknown> = {}) =>
  refusal("run_command", { command, params }, OURS);

describe("guard policy", () => {
  it("allows ordinary design work and joining our server", () => {
    expect(run("layout.add")).toBeNull();
    expect(refusal("create_node", { type: "frame" }, OURS)).toBeNull();
    expect(run("collab.join", { link: "wss://figcraft.dev.mtapp.dev/?file=a&token=b" })).toBeNull();
    expect(run("collab.peers")).toBeNull();
    expect(run("collab.leave")).toBeNull();
  });
  it("refuses sharing, publishing and hosting", () => {
    for (const command of [
      "collab.share",
      "collab.publish",
      "collab.host",
      "collab.manageFile",
      "library.publishToServer",
      "pref.publishServer",
    ]) {
      expect(run(command)).toBe(
        `${command} is not allowed here: Paseo shares design files for you`,
      );
    }
  });
  it("refuses joining another server", () => {
    expect(run("collab.join", { link: "wss://collab.craftapps.dev/?file=a&token=b" })).toBe(
      "collab.join may only join files on wss://figcraft.dev.mtapp.dev/",
    );
    expect(run("collab.join", { code: "K7M-2QX-9TD" })).toBe(
      "collab.join may only join files on wss://figcraft.dev.mtapp.dev/",
    );
  });
  it("checks every command of a batch", () => {
    expect(
      refusal(
        "batch",
        { commands: [{ command: "layout.add" }, { command: "collab.share" }] },
        OURS,
      ),
    ).toBe("collab.share is not allowed here: Paseo shares design files for you");
  });
});
```

- [ ] **Step 2: Run, fail. Step 3: Implement the policy**

```js
// Which FigCraft calls an agent's figcraft-cli may make. Plain JS: the guard runs under node
// without a build step. Paseo publishes files and hands out links; agents only join ours.

const REFUSED = new Set([
  "collab.share",
  "collab.publish",
  "collab.host",
  "collab.manageFile",
  "library.publishToServer",
  "pref.publishServer",
]);

function hostOf(text) {
  try {
    return new URL(text).host;
  } catch {
    return null;
  }
}

function refuseCommand(command, params, ourServer) {
  if (REFUSED.has(command))
    return `${command} is not allowed here: Paseo shares design files for you`;
  if (command === "collab.join") {
    const link =
      typeof params?.link === "string"
        ? params.link
        : typeof params?.code === "string"
          ? params.code
          : "";
    if (hostOf(link) !== hostOf(ourServer))
      return `collab.join may only join files on ${ourServer}`;
  }
  return null;
}

/** @returns {string | null} why the call is refused, or null when it may go through */
export function refusal(toolName, args, ourServer) {
  if (toolName === "run_command")
    return refuseCommand(String(args?.command ?? ""), args?.params, ourServer);
  if (toolName === "batch") {
    for (const step of Array.isArray(args?.commands) ? args.commands : []) {
      const why = refuseCommand(String(step?.command ?? ""), step?.params, ourServer);
      if (why) return why;
    }
  }
  return null;
}
```

- [ ] **Step 4: Failing guard test (end to end over the fake)**

```ts
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { describe, expect, it } from "vitest";

const GUARD = new URL("./figcraft-guard.mjs", import.meta.url).pathname;
const FAKE = new URL("../test/fake-figcraft.mjs", import.meta.url).pathname;

function start() {
  const child = spawn(
    process.execPath,
    [GUARD, "--server", "wss://figcraft.dev.mtapp.dev/", "--", process.execPath, FAKE],
    { stdio: "pipe" },
  );
  const answers = new Map<number, unknown>();
  createInterface({ input: child.stdout }).on("line", (line) => {
    const message = JSON.parse(line);
    answers.set(message.id, message.result);
  });
  const call = async (id: number, method: string, params: unknown) => {
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    for (let i = 0; i < 100 && !answers.has(id); i++) await new Promise((r) => setTimeout(r, 20));
    return answers.get(id) as { isError?: boolean; content?: { text?: string }[] };
  };
  return { child, call };
}

describe("figcraft-guard", () => {
  it("passes allowed calls to FigCraft and answers refused ones itself", async () => {
    const { child, call } = start();
    await call(1, "initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "t", version: "1" },
    });
    const allowed = await call(2, "tools/call", {
      name: "run_command",
      arguments: { command: "collab.peers", params: {} },
    });
    expect(allowed.isError).toBeUndefined();
    const refused = await call(3, "tools/call", {
      name: "run_command",
      arguments: { command: "collab.share", params: {} },
    });
    expect(refused).toEqual({
      isError: true,
      content: [
        {
          type: "text",
          text: "collab.share is not allowed here: Paseo shares design files for you",
        },
      ],
    });
    child.kill();
  });
});
```

- [ ] **Step 5: Implement the guard**

```js
#!/usr/bin/env node
// stdio proxy: node figcraft-guard.mjs --server <wss-url> -- <figcraft-cli> mcp <args...>
// Lines from the agent go to figcraft-cli unless the policy refuses a tools/call, which the guard
// answers itself. Everything from figcraft-cli goes back unchanged.
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { refusal } from "./guard-policy.mjs";

const argv = process.argv.slice(2);
const split = argv.indexOf("--");
const serverAt = argv.indexOf("--server");
if (split === -1 || serverAt === -1 || serverAt > split) {
  process.stderr.write("usage: figcraft-guard --server <wss-url> -- <figcraft-cli> mcp ...\n");
  process.exit(2);
}
const ourServer = argv[serverAt + 1];
const [command, ...args] = argv.slice(split + 1);
const child = spawn(command, args, { stdio: ["pipe", "inherit", "inherit"] });
child.on("exit", (code, signal) => process.exit(signal ? 1 : (code ?? 0)));
child.on("error", (error) => {
  process.stderr.write(`figcraft-guard: could not start ${command}: ${error.message}\n`);
  process.exit(1);
});
process.on("SIGTERM", () => child.kill("SIGTERM"));

createInterface({ input: process.stdin, crlfDelay: Infinity }).on("line", (line) => {
  let message = null;
  try {
    message = JSON.parse(line);
  } catch {
    // Not ours to judge: FigCraft answers a malformed line itself.
  }
  const why =
    message?.method === "tools/call"
      ? refusal(message.params?.name, message.params?.arguments, ourServer)
      : null;
  if (why) {
    process.stdout.write(
      `${JSON.stringify({ jsonrpc: "2.0", id: message.id, result: { isError: true, content: [{ type: "text", text: why }] } })}\n`,
    );
    return;
  }
  child.stdin.write(`${line}\n`);
});
process.stdin.on("end", () => child.stdin.end());
```

- [ ] **Step 6: Run both test files, pass. Commit** `feat(fork): guard agents' FigCraft so only Paseo shares design files` with the four `plugins/design/bin/` files.

---

### Task 7: The bridge for one open file

**Files:**

- Create: `plugins/design/server/bridge.ts`, `plugins/design/server/bridge.test.ts`

**Interfaces:**

- Consumes: `FigcraftSession` (Task 5), `toVariables`, `fromVariables`, `sameTokens`, `TokensError`, `TokenFile` (Task 3), `DesignFile` (Task 4).
- Produces:
  - `interface TokensPort { read(): Promise<TokenFile | null>; write(file: TokenFile): Promise<void> }` (null = no tokens file)
  - `type TokensState = { status: "none" } | { status: "imported"; warnings: string[] } | { status: "refused"; reason: string } | { status: "written-back" }`
  - `class Bridge` with `static open({ session, file, tokens, log }): Promise<Bridge>`, `readonly tokens: TokensState`, `userSelection(): Promise<string[]>`, `picture(ids?: string[]): Promise<{ mimeType: string; data: string }>`, `pageBounds()`, `syncTokensBack(): Promise<boolean>`, `outOfStep(): Promise<boolean>`, `openThreads(): Promise<CommentThread[]>`, `commentPrompt(ids: string[]): Promise<string>`, `addComment(x, y, text): Promise<void>`, `code(ids: string[]): Promise<string>`, `close(): Promise<void>`, `onExit(listener)`.

- [ ] **Step 1: Failing tests** (over the fake, as in Task 5's tests; `session()` helper copied from `figcraft-session.test.ts`)

```ts
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Bridge, type TokensPort } from "./bridge.js";
import type { DesignFile } from "./files-store.js";
import { FigcraftSession } from "./figcraft-session.js";
import type { TokenFile } from "./tokens.js";

const FAKE = new URL("../test/fake-figcraft.mjs", import.meta.url).pathname;
const FILE: DesignFile = {
  id: "f1",
  projectKey: "p1",
  name: "Login",
  createdAt: 1,
  lastAgentId: null,
  secrets: { editLink: "wss://figcraft.example/?file=f1&token=e", viewLink: "v", ownerToken: null },
};

async function open(tokens: TokenFile | null, env: Record<string, string> = {}) {
  const dir = mkdtempSync(join(tmpdir(), "design-bridge-"));
  const logFile = join(dir, "calls.log");
  const session = await FigcraftSession.start({
    command: process.execPath,
    args: [FAKE],
    env: { FAKE_FIGCRAFT_LOG: logFile, ...env },
    runDir: dir,
    name: "b",
  });
  let written: TokenFile | null = null;
  const port: TokensPort = {
    read: async () => tokens,
    write: async (file) => {
      written = file;
    },
  };
  const lines: string[] = [];
  const bridge = await Bridge.open({
    session,
    file: FILE,
    tokens: port,
    log: (line) => lines.push(line),
  });
  const calls = () =>
    readFileSync(logFile, "utf8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));
  return { bridge, calls, written: () => written, lines };
}

const TOKENS = { color: { $type: "color", accent: { $value: "#3366cc" } } };

describe("Bridge", () => {
  it("joins with the edit link, then imports the repo's tokens", async () => {
    const { bridge, calls } = await open(TOKENS);
    expect(calls()[0].arguments).toEqual({
      command: "collab.join",
      params: { link: FILE.secrets.editLink },
    });
    expect(calls().some((c) => c.arguments?.command === "variable.import")).toBe(true);
    expect(bridge.tokens).toEqual({ status: "imported", warnings: [] });
    await bridge.close();
  });
  it("opens without tokens when the repo has none", async () => {
    const { bridge } = await open(null);
    expect(bridge.tokens).toEqual({ status: "none" });
    await bridge.close();
  });
  it("refuses a bad tokens file with the reason and imports nothing", async () => {
    const { bridge, calls } = await open({ x: { $value: "#fff" } });
    expect(bridge.tokens).toEqual({
      status: "refused",
      reason: "x: no $type on the token or its groups",
    });
    expect(calls().some((c) => c.arguments?.command === "variable.import")).toBe(false);
    await bridge.close();
  });
  it("writes FigCraft's token edits back to the repo, once", async () => {
    const { bridge, written } = await open(TOKENS);
    expect(await bridge.syncTokensBack()).toBe(false);
    // The fake echoes the imported variables; change them as a FigCraft edit would.
    // (The fake keeps state in memory: import a changed set through the session.)
    await (bridge as unknown as { session: FigcraftSession }).session.importVariables({
      meta: {
        variableCollections: {
          "c:tokens": {
            id: "c:tokens",
            name: "Tokens",
            modes: [{ modeId: "m:default", name: "Default" }],
            defaultModeId: "m:default",
            variableIds: ["v:color/accent"],
          },
        },
        variables: {
          "v:color/accent": {
            id: "v:color/accent",
            name: "color/accent",
            variableCollectionId: "c:tokens",
            resolvedType: "COLOR",
            valuesByMode: { "m:default": { r: 1, g: 0, b: 0, a: 1 } },
          },
        },
      },
    });
    expect(await bridge.outOfStep()).toBe(true);
    expect(await bridge.syncTokensBack()).toBe(true);
    expect(written()).toEqual({ color: { $type: "color", accent: { $value: "#ff0000" } } });
    expect(bridge.tokens).toEqual({ status: "written-back" });
    await bridge.close();
  });
  it("reads the user's selection, not an agent's", async () => {
    const { bridge } = await open(null, { FAKE_FIGCRAFT_SELECTION: "n1" });
    expect(await bridge.userSelection()).toEqual(["n1"]);
    await bridge.close();
  });
  it("lists open threads not written by an agent", async () => {
    const comments = JSON.stringify([
      { id: "c1", status: "open", author: "You", agent: false, preview: "rounder" },
      { id: "c2", status: "open", author: "Claude (agent)", agent: true, preview: "done" },
      { id: "c3", status: "resolved", author: "You", agent: false, preview: "old" },
    ]);
    const { bridge } = await open(null, { FAKE_FIGCRAFT_COMMENTS: comments });
    expect((await bridge.openThreads()).map((t) => t.id)).toEqual(["c1"]);
    await bridge.close();
  });
  it("never logs the edit link", async () => {
    const { bridge, lines } = await open({ x: { $value: "#fff" } });
    expect(lines.join("\n")).not.toContain("token=e");
    await bridge.close();
  });
});
```

- [ ] **Step 2: Run, fail. Step 3: Implement**

```ts
import type { CommentThread, FigcraftSession } from "./figcraft-session.js";
import type { DesignFile } from "./files-store.js";
import { fromVariables, sameTokens, toVariables, TokensError, type TokenFile } from "./tokens.js";

export interface TokensPort {
  /** The workspace's design/tokens.json, or null when the repo has none. Throws on bad JSON. */
  read(): Promise<TokenFile | null>;
  write(file: TokenFile): Promise<void>;
}

export type TokensState =
  | { status: "none" }
  | { status: "imported"; warnings: string[] }
  | { status: "refused"; reason: string }
  | { status: "written-back" };

const MAX_CODE_LAYERS = 3;

export class Bridge {
  tokens: TokensState = { status: "none" };
  private repoTokens: TokenFile | null = null;

  private constructor(
    private readonly session: FigcraftSession,
    private readonly port: TokensPort,
    private readonly log: (line: string) => void,
    private readonly fileId: string,
  ) {}

  /** Joins the file's live session, then loads the repo's tokens: the repo wins on open. */
  static async open(options: {
    session: FigcraftSession;
    file: DesignFile;
    tokens: TokensPort;
    log(line: string): void;
  }): Promise<Bridge> {
    const bridge = new Bridge(options.session, options.tokens, options.log, options.file.id);
    try {
      await options.session.join(options.file.secrets.editLink);
    } catch (error) {
      await options.session.close();
      throw new Error(`Could not open the design: ${(error as Error).message}`);
    }
    await bridge.importTokens();
    return bridge;
  }

  private async importTokens(): Promise<void> {
    let file: TokenFile | null;
    try {
      file = await this.port.read();
    } catch (error) {
      this.tokens = {
        status: "refused",
        reason: `design/tokens.json is not valid JSON (${(error as Error).message})`,
      };
      return;
    }
    if (file === null) return;
    try {
      const { variables, warnings } = toVariables(file);
      const answer = await this.session.importVariables(variables);
      this.repoTokens = file;
      this.tokens = { status: "imported", warnings: [...warnings, ...answer.warnings] };
    } catch (error) {
      const reason =
        error instanceof TokensError
          ? error.message
          : `FigCraft refused the tokens: ${(error as Error).message}`;
      this.tokens = { status: "refused", reason };
      this.log(`[design] tokens not imported for ${this.fileId}: ${reason}`);
    }
  }

  async userSelection(): Promise<string[]> {
    const { peers } = await this.session.peers();
    const people = peers.filter((peer) => !/\(agent\)$/.test(peer.name));
    return [...new Set(people.flatMap((peer) => peer.selection))];
  }

  picture(ids?: string[]): Promise<{ mimeType: string; data: string }> {
    return this.session.screenshot(ids, 1600);
  }

  pageBounds() {
    return this.session.pageBounds();
  }

  async outOfStep(): Promise<boolean> {
    if (this.repoTokens === null) return false;
    return !sameTokens(this.repoTokens, await this.session.exportVariables());
  }

  /** Writes FigCraft's token edits to the repo (uncommitted). True when the file changed. */
  async syncTokensBack(): Promise<boolean> {
    if (this.repoTokens === null) return false;
    const exported = await this.session.exportVariables();
    if (sameTokens(this.repoTokens, exported)) return false;
    const next = fromVariables(exported, this.repoTokens);
    await this.port.write(next);
    this.repoTokens = next;
    this.tokens = { status: "written-back" };
    return true;
  }

  async openThreads(): Promise<CommentThread[]> {
    return (await this.session.comments()).filter((t) => t.status === "open" && !t.agent);
  }

  commentPrompt(ids: string[]): Promise<string> {
    return this.session.commentPrompt(ids);
  }

  async addComment(x: number, y: number, text: string): Promise<void> {
    await this.session.addComment(x, y, text);
  }

  async code(ids: string[]): Promise<string> {
    const parts: string[] = [];
    for (const id of ids.slice(0, MAX_CODE_LAYERS))
      parts.push(`// layer ${id}\n${await this.session.code(id)}`);
    if (ids.length > MAX_CODE_LAYERS)
      parts.push(`// ${ids.length - MAX_CODE_LAYERS} more layers not exported`);
    return parts.join("\n\n");
  }

  onExit(listener: (reason: string) => void): void {
    this.session.onExit(listener);
  }

  close(): Promise<void> {
    return this.session.close();
  }
}
```

The "writes back" test reaches `bridge.session` by a cast; keep `session` a `private readonly` constructor field (TypeScript `private` is compile-time only).

- [ ] **Step 4: Run, pass (7 tests). Commit** `feat(fork): design bridge joins a file, syncs tokens and reads selection and comments`.

---

### Task 8: Bridges: cap, idle stop, one restart

**Files:**

- Create: `plugins/design/server/bridges.ts`, `plugins/design/server/bridges.test.ts`

**Interfaces:**

- Consumes: `Bridge` (Task 7).
- Produces:
  - `type Holder = { kind: "viewer"; id: string } | { kind: "agent"; id: string }`
  - `type BridgeStatus = { status: "stopped" } | { status: "starting" } | { status: "running" } | { status: "failed"; error: string }`
  - `createBridges({ max, idleMs, openBridge(fileId): Promise<Bridge>, clock: { setTimeout(fn, ms): unknown; clearTimeout(handle): void }, log, onStatus(fileId, status) }): Bridges`
  - `interface Bridges { acquire(fileId: string, holder: Holder): Promise<Bridge>; release(fileId: string, holder: Holder): void; releaseAgent(agentId: string): void; running(): string[]; status(fileId: string): BridgeStatus; stopAll(): Promise<void> }`
  - `class TooManyDesigns extends Error` with message `Too many open designs (3). Close one first.`

- [ ] **Step 1: Failing tests** (with a fake `Bridge`-like object and a manual clock)

```ts
import { describe, expect, it } from "vitest";
import type { Bridge } from "./bridge.js";
import { createBridges, TooManyDesigns } from "./bridges.js";

function fakeClock() {
  let now = 0;
  const timers: { at: number; fn: () => void; id: number }[] = [];
  let next = 1;
  return {
    setTimeout(fn: () => void, ms: number) {
      const id = next++;
      timers.push({ at: now + ms, fn, id });
      return id;
    },
    clearTimeout(id: unknown) {
      const i = timers.findIndex((t) => t.id === id);
      if (i >= 0) timers.splice(i, 1);
    },
    advance(ms: number) {
      now += ms;
      for (const t of timers.filter((t) => t.at <= now)) {
        timers.splice(timers.indexOf(t), 1);
        t.fn();
      }
    },
  };
}

function fakeBridge() {
  let exit: ((reason: string) => void) | null = null;
  const bridge = {
    closed: 0,
    onExit(listener: (reason: string) => void) {
      exit = listener;
    },
    async close() {
      bridge.closed += 1;
    },
    crash(reason: string) {
      exit?.(reason);
    },
  };
  return bridge;
}

function setup(max = 2) {
  const clock = fakeClock();
  const made: ReturnType<typeof fakeBridge>[] = [];
  const statuses: string[] = [];
  const bridges = createBridges({
    max,
    idleMs: 300_000,
    openBridge: async () => {
      const b = fakeBridge();
      made.push(b);
      return b as unknown as Bridge;
    },
    clock,
    log: () => {},
    onStatus: (fileId, status) => statuses.push(`${fileId}:${status.status}`),
  });
  return { bridges, clock, made, statuses };
}

const viewer = (id: string) => ({ kind: "viewer" as const, id });
const agent = (id: string) => ({ kind: "agent" as const, id });

describe("bridges", () => {
  it("shares one bridge per file between holders", async () => {
    const { bridges, made } = setup();
    const a = await bridges.acquire("f1", viewer("v1"));
    const b = await bridges.acquire("f1", agent("a1"));
    expect(a).toBe(b);
    expect(made).toHaveLength(1);
  });
  it("stops a bridge 5 minutes after its last holder leaves, not before", async () => {
    const { bridges, clock, made } = setup();
    await bridges.acquire("f1", viewer("v1"));
    bridges.release("f1", viewer("v1"));
    clock.advance(299_000);
    expect(made[0].closed).toBe(0);
    await bridges.acquire("f1", viewer("v2"));
    bridges.release("f1", viewer("v2"));
    clock.advance(300_000);
    await new Promise((r) => setTimeout(r, 0));
    expect(made[0].closed).toBe(1);
    expect(bridges.running()).toEqual([]);
  });
  it("refuses a file over the cap", async () => {
    const { bridges } = setup(2);
    await bridges.acquire("f1", viewer("v"));
    await bridges.acquire("f2", viewer("v"));
    await expect(bridges.acquire("f3", viewer("v"))).rejects.toThrow(new TooManyDesigns(2));
  });
  it("restarts a crashed bridge once, then marks it failed", async () => {
    const { bridges, made, statuses } = setup();
    await bridges.acquire("f1", viewer("v1"));
    made[0].crash("exited with 3");
    await new Promise((r) => setTimeout(r, 0));
    expect(made).toHaveLength(2);
    made[1].crash("exited with 3");
    await new Promise((r) => setTimeout(r, 0));
    expect(made).toHaveLength(2);
    expect(bridges.status("f1")).toEqual({
      status: "failed",
      error: "Bridge stopped: exited with 3",
    });
    expect(statuses).toContain("f1:failed");
  });
  it("releases every file an agent held when the agent goes", async () => {
    const { bridges, clock, made } = setup();
    await bridges.acquire("f1", agent("a1"));
    await bridges.acquire("f2", agent("a1"));
    bridges.releaseAgent("a1");
    clock.advance(300_000);
    await new Promise((r) => setTimeout(r, 0));
    expect(made.map((b) => b.closed)).toEqual([1, 1]);
  });
});
```

- [ ] **Step 2: Run, fail. Step 3: Implement**

```ts
import type { Bridge } from "./bridge.js";

export type Holder = { kind: "viewer"; id: string } | { kind: "agent"; id: string };
export type BridgeStatus =
  | { status: "stopped" }
  | { status: "starting" }
  | { status: "running" }
  | { status: "failed"; error: string };

export class TooManyDesigns extends Error {
  constructor(max: number) {
    super(`Too many open designs (${max}). Close one first.`);
    this.name = "TooManyDesigns";
  }
}

export interface Bridges {
  acquire(fileId: string, holder: Holder): Promise<Bridge>;
  release(fileId: string, holder: Holder): void;
  releaseAgent(agentId: string): void;
  running(): string[];
  status(fileId: string): BridgeStatus;
  stopAll(): Promise<void>;
}

interface Entry {
  bridge: Promise<Bridge>;
  holders: Set<string>;
  idle: unknown | null;
  restarts: number;
  stopping: boolean;
}

const key = (holder: Holder) => `${holder.kind}:${holder.id}`;

export function createBridges(options: {
  max: number;
  idleMs: number;
  openBridge(fileId: string): Promise<Bridge>;
  clock: { setTimeout(fn: () => void, ms: number): unknown; clearTimeout(handle: unknown): void };
  log(line: string): void;
  onStatus(fileId: string, status: BridgeStatus): void;
}): Bridges {
  const entries = new Map<string, Entry>();
  const failed = new Map<string, string>();

  function setStatus(fileId: string, status: BridgeStatus): void {
    try {
      options.onStatus(fileId, status);
    } catch (error) {
      options.log(`[design] status listener failed: ${(error as Error).message}`);
    }
  }

  function start(fileId: string, entry: Entry): Promise<Bridge> {
    setStatus(fileId, { status: "starting" });
    const opening = options.openBridge(fileId).then((bridge) => {
      bridge.onExit((reason) => crashed(fileId, reason));
      setStatus(fileId, { status: "running" });
      return bridge;
    });
    opening.catch((error: Error) => {
      entries.delete(fileId);
      failed.set(fileId, error.message);
      setStatus(fileId, { status: "failed", error: error.message });
    });
    entry.bridge = opening;
    return opening;
  }

  function crashed(fileId: string, reason: string): void {
    const entry = entries.get(fileId);
    if (!entry || entry.stopping) return;
    if (entry.restarts >= 1) {
      entries.delete(fileId);
      const error = `Bridge stopped: ${reason}`;
      failed.set(fileId, error);
      options.log(`[design] ${fileId}: ${error}`);
      setStatus(fileId, { status: "failed", error });
      return;
    }
    entry.restarts += 1;
    options.log(`[design] ${fileId}: bridge ${reason}; restarting once`);
    void start(fileId, entry).catch(() => undefined);
  }

  async function stop(fileId: string): Promise<void> {
    const entry = entries.get(fileId);
    if (!entry) return;
    entry.stopping = true;
    entries.delete(fileId);
    try {
      await (await entry.bridge).close();
    } catch (error) {
      options.log(`[design] ${fileId}: close failed: ${(error as Error).message}`);
    }
    setStatus(fileId, { status: "stopped" });
  }

  function scheduleIdle(fileId: string, entry: Entry): void {
    if (entry.holders.size > 0 || entry.idle !== null) return;
    entry.idle = options.clock.setTimeout(() => void stop(fileId), options.idleMs);
  }

  return {
    async acquire(fileId, holder) {
      let entry = entries.get(fileId);
      if (!entry) {
        if (entries.size >= options.max) throw new TooManyDesigns(options.max);
        failed.delete(fileId);
        entry = {
          bridge: Promise.resolve(null as unknown as Bridge),
          holders: new Set(),
          idle: null,
          restarts: 0,
          stopping: false,
        };
        entries.set(fileId, entry);
        start(fileId, entry);
      }
      if (entry.idle !== null) {
        options.clock.clearTimeout(entry.idle);
        entry.idle = null;
      }
      entry.holders.add(key(holder));
      return entry.bridge;
    },
    release(fileId, holder) {
      const entry = entries.get(fileId);
      if (!entry) return;
      entry.holders.delete(key(holder));
      scheduleIdle(fileId, entry);
    },
    releaseAgent(agentId) {
      for (const [fileId, entry] of entries) {
        if (entry.holders.delete(`agent:${agentId}`)) scheduleIdle(fileId, entry);
      }
    },
    running: () => [...entries.keys()],
    status(fileId) {
      if (entries.has(fileId)) return { status: "running" };
      const error = failed.get(fileId);
      return error ? { status: "failed", error } : { status: "stopped" };
    },
    async stopAll() {
      await Promise.all([...entries.keys()].map((fileId) => stop(fileId)));
    },
  };
}
```

- [ ] **Step 4: Run, pass (5 tests). Commit** `feat(fork): design bridges with a cap, idle stop and one restart`.

---

### Task 9: Comments to the file's agent, one prompt per turn

**Files:**

- Create: `plugins/design/server/comments.ts`, `plugins/design/server/comments.test.ts`

**Interfaces:**

- Produces:
  - `interface CommentPorts { openThreads(fileId): Promise<{ id: string }[]>; prompt(fileId, ids): Promise<string>; agentOf(fileId): Promise<string | null>; agentIdle(agentId): Promise<boolean>; send(agentId, text): Promise<void>; log(line): void }`
  - `createCommentRouter(ports): CommentRouter`
  - `interface CommentRouter { poll(fileId: string): Promise<void>; turnEnded(agentId: string): Promise<void>; forget(fileId: string): void }`

Rules: a thread is sent once. New threads found by `poll` wait in the file's queue. They go out as one prompt when the file's agent is idle (at `poll`) or when its turn ends (`turnEnded`); at most one prompt per agent per turn (a sent prompt marks the agent busy until `turnEnded`). No agent yet: they wait.

- [ ] **Step 1: Failing tests**

```ts
import { describe, expect, it } from "vitest";
import { createCommentRouter, type CommentPorts } from "./comments.js";

function ports(over: Partial<CommentPorts> = {}) {
  const sent: { agentId: string; text: string }[] = [];
  let threads = [{ id: "c1" }];
  let idle = true;
  const p: CommentPorts = {
    openThreads: async () => threads,
    prompt: async (_f, ids) => `Fix ${ids.join(",")}`,
    agentOf: async () => "a1",
    agentIdle: async () => idle,
    send: async (agentId, text) => {
      sent.push({ agentId, text });
    },
    log: () => {},
    ...over,
  };
  return {
    p,
    sent,
    setThreads: (t: { id: string }[]) => (threads = t),
    setIdle: (v: boolean) => (idle = v),
  };
}

describe("comment router", () => {
  it("sends new open threads to the idle agent as one prompt", async () => {
    const { p, sent, setThreads } = ports();
    setThreads([{ id: "c1" }, { id: "c2" }]);
    const router = createCommentRouter(p);
    await router.poll("f1");
    expect(sent).toEqual([{ agentId: "a1", text: "Fix c1,c2" }]);
  });
  it("sends a thread only once", async () => {
    const { p, sent } = ports();
    const router = createCommentRouter(p);
    await router.poll("f1");
    await router.turnEnded("a1");
    await router.poll("f1");
    expect(sent).toHaveLength(1);
  });
  it("waits while the agent works and sends when its turn ends, one prompt per turn", async () => {
    const { p, sent, setThreads, setIdle } = ports();
    setIdle(false);
    const router = createCommentRouter(p);
    await router.poll("f1");
    expect(sent).toHaveLength(0);
    setThreads([{ id: "c1" }, { id: "c2" }]);
    await router.poll("f1");
    await router.turnEnded("a1");
    expect(sent).toEqual([{ agentId: "a1", text: "Fix c1,c2" }]);
    setThreads([{ id: "c1" }, { id: "c2" }, { id: "c3" }]);
    setIdle(true);
    await router.poll("f1");
    expect(sent).toHaveLength(1);
    await router.turnEnded("a1");
    expect(sent[1]).toEqual({ agentId: "a1", text: "Fix c3" });
  });
  it("keeps threads waiting while the file has no agent", async () => {
    let agent: string | null = null;
    const { p, sent } = ports({ agentOf: async () => agent });
    const router = createCommentRouter(p);
    await router.poll("f1");
    expect(sent).toHaveLength(0);
    agent = "a2";
    await router.poll("f1");
    expect(sent).toEqual([{ agentId: "a2", text: "Fix c1" }]);
  });
  it("logs a failed send and tries again at the next poll", async () => {
    let fail = true;
    const lines: string[] = [];
    const { p, sent } = ports({
      send: async (agentId, text) => {
        if (fail) throw new Error("agent gone");
        sent.push({ agentId, text });
      },
      log: (line) => lines.push(line),
    });
    const router = createCommentRouter(p);
    await router.poll("f1");
    expect(lines[0]).toContain("agent gone");
    fail = false;
    await router.poll("f1");
    expect(sent).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run, fail. Step 3: Implement**

```ts
export interface CommentPorts {
  openThreads(fileId: string): Promise<{ id: string }[]>;
  prompt(fileId: string, ids: string[]): Promise<string>;
  agentOf(fileId: string): Promise<string | null>;
  agentIdle(agentId: string): Promise<boolean>;
  send(agentId: string, text: string): Promise<void>;
  log(line: string): void;
}

export interface CommentRouter {
  poll(fileId: string): Promise<void>;
  turnEnded(agentId: string): Promise<void>;
  forget(fileId: string): void;
}

export function createCommentRouter(ports: CommentPorts): CommentRouter {
  const sentIds = new Map<string, Set<string>>();
  const waiting = new Map<string, string[]>();
  /** Agents that got a prompt in their current turn. */
  const prompted = new Set<string>();

  async function deliver(fileId: string, agentId: string): Promise<void> {
    const ids = waiting.get(fileId) ?? [];
    if (ids.length === 0 || prompted.has(agentId)) return;
    try {
      const text = await ports.prompt(fileId, ids);
      await ports.send(agentId, text);
      const sent = sentIds.get(fileId) ?? new Set<string>();
      for (const id of ids) sent.add(id);
      sentIds.set(fileId, sent);
      waiting.set(fileId, []);
      prompted.add(agentId);
    } catch (error) {
      ports.log(`[design] comments for ${fileId} not sent: ${(error as Error).message}`);
    }
  }

  return {
    async poll(fileId) {
      const sent = sentIds.get(fileId) ?? new Set<string>();
      const queued = new Set(waiting.get(fileId) ?? []);
      for (const thread of await ports.openThreads(fileId)) {
        if (!sent.has(thread.id)) queued.add(thread.id);
      }
      waiting.set(fileId, [...queued]);
      const agentId = await ports.agentOf(fileId);
      if (agentId === null || prompted.has(agentId)) return;
      if (await ports.agentIdle(agentId)) await deliver(fileId, agentId);
    },
    async turnEnded(agentId) {
      prompted.delete(agentId);
      for (const fileId of waiting.keys()) {
        if ((await ports.agentOf(fileId)) === agentId) await deliver(fileId, agentId);
      }
    },
    forget(fileId) {
      waiting.delete(fileId);
      sentIds.delete(fileId);
    },
  };
}
```

- [ ] **Step 4: Run, pass (5 tests). Commit** `feat(fork): design comments reach the file's agent, one prompt per turn`.

---

### Task 10: Send to agent

**Files:**

- Create: `plugins/design/server/send-to-agent.ts`, `plugins/design/server/send-to-agent.test.ts`

**Interfaces:**

- Produces: `buildSendPrompt({ fileName, fileId, ids, code, note }): string` and `sendSelection({ bridge, file, agentId, note, send }): Promise<{ ok: true } | { ok: false; error: string }>` where `send(agentId, text, images)` sends with `activeTurnBehavior: "steer"`.

- [ ] **Step 1: Failing tests**

````ts
import { describe, expect, it } from "vitest";
import { buildSendPrompt, sendSelection } from "./send-to-agent.js";

describe("Send to agent", () => {
  it("builds one prompt with the note, the file, the layers and the code", () => {
    expect(
      buildSendPrompt({
        fileName: "Login",
        fileId: "f1",
        ids: ["n1", "n2"],
        code: "<div/>",
        note: "build this",
      }),
    ).toBe(
      [
        "build this",
        "",
        'From the design "Login" (design_join {"file":"f1"} opens it), layers n1, n2.',
        "FigCraft's code export for them, as a reference only: write the code in this project's own stack and components.",
        "",
        "```tsx",
        "<div/>",
        "```",
      ].join("\n"),
    );
  });
  it("sends the prompt and a picture of the selection", async () => {
    const calls: unknown[] = [];
    const bridge = {
      userSelection: async () => ["n1"],
      code: async () => "<div/>",
      picture: async (ids?: string[]) => ({ mimeType: "image/png", data: `png:${ids?.join(",")}` }),
    };
    const result = await sendSelection({
      bridge: bridge as never,
      file: { id: "f1", name: "Login" } as never,
      agentId: "a1",
      note: "build this",
      send: async (...args) => {
        calls.push(args);
      },
    });
    expect(result).toEqual({ ok: true });
    expect(calls[0]).toEqual([
      "a1",
      expect.stringContaining("layers n1"),
      [{ mimeType: "image/png", data: "png:n1" }],
    ]);
  });
  it("says so when nothing is selected", async () => {
    const bridge = { userSelection: async () => [] };
    expect(
      await sendSelection({
        bridge: bridge as never,
        file: { id: "f1", name: "L" } as never,
        agentId: "a1",
        note: "",
        send: async () => {},
      }),
    ).toEqual({ ok: false, error: "Select a frame or layers in the design first" });
  });
});
````

- [ ] **Step 2: Run, fail. Step 3: Implement**

````ts
import type { Bridge } from "./bridge.js";
import type { DesignFile } from "./files-store.js";

export function buildSendPrompt(input: {
  fileName: string;
  fileId: string;
  ids: string[];
  code: string;
  note: string;
}): string {
  return [
    input.note.trim() || "Build this design.",
    "",
    `From the design "${input.fileName}" (design_join {"file":"${input.fileId}"} opens it), layers ${input.ids.join(", ")}.`,
    "FigCraft's code export for them, as a reference only: write the code in this project's own stack and components.",
    "",
    "```tsx",
    input.code,
    "```",
  ].join("\n");
}

export async function sendSelection(input: {
  bridge: Pick<Bridge, "userSelection" | "code" | "picture">;
  file: Pick<DesignFile, "id" | "name">;
  agentId: string;
  note: string;
  send(agentId: string, text: string, images: { mimeType: string; data: string }[]): Promise<void>;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const ids = await input.bridge.userSelection();
    if (ids.length === 0)
      return { ok: false, error: "Select a frame or layers in the design first" };
    const code = await input.bridge.code(ids);
    const picture = await input.bridge.picture(ids);
    const text = buildSendPrompt({
      fileName: input.file.name,
      fileId: input.file.id,
      ids,
      code,
      note: input.note,
    });
    await input.send(input.agentId, text, [picture]);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
}
````

- [ ] **Step 4: Run, pass (3 tests). Commit** `feat(fork): design Send to agent with code and a picture`.

---

### Task 11: Contracts, the design service, `design_join` and the daemon wiring

**Files:**

- Create: `plugins/design/shared/contracts.ts`
- Create: `plugins/design/server/design.ts`, `plugins/design/server/design.test.ts`
- Create: `plugins/design/server/agent-tools.ts`, `plugins/design/server/agent-tools.test.ts`
- Modify: `plugins/design/index.server.ts`

**Interfaces:**

- Consumes: everything from Tasks 2-10.
- Produces (client and later tasks rely on these names):
  - `designFilesRpc` `design.files.request` `{ workspaceId } -> { enabled: true; files: FileRow[] } | { enabled: false; reason: string }`, `FileRow = PublicDesignFile & { status: BridgeStatus["status"]; error: string | null; outOfStep: boolean }`
  - `createFileRpc` `design.create.request` `{ workspaceId, name } -> { ok: true; file: PublicDesignFile } | { ok: false; error }`
  - `renameFileRpc` `design.rename.request` `{ fileId, name } -> same result shape`
  - `removeFileRpc` `design.remove.request` `{ fileId } -> { ok: true } | { ok: false; error }` (forgets the file in Paseo; the file stays on the server, see Decision 6)
  - `editorLinkRpc` `design.editor_link.request` `{ fileId } -> { ok: true; url: string } | { ok: false; error }` (the only message that carries a link)
  - `addCommentRpc` `design.comment.request` `{ fileId, x, y, text }` with `x, y` in 0..1 of the picture `-> { ok: true } | { ok: false; error }`
  - `sendRpc` `design.send.request` `{ fileId, agentId, note } -> { ok: true } | { ok: false; error }`
  - `agentsRpc` `design.agents.request` `{ workspaceId } -> { agents: { id: string; title: string }[] }`
  - `viewSubscription` `design.view` `{ fileId, workspaceId, pictures: boolean }` events: `{ type: "status"; status; error }`, `{ type: "picture"; seq: number; uri: string }` (a `data:` URI), `{ type: "tokens"; tokens: TokensState }`, `{ type: "threads"; threads: { id; author; preview }[] }`, `{ type: "tokens-written" }`
  - `createDesignService(deps): DesignService` and `designTools(service): AgentToolDefinition[]` with the one tool `design_join`.

Remove follows Decision 6.

- [ ] **Step 1: Contracts**

```ts
import { defineRpc, defineSubscription } from "@getpaseo/plugin";
import { z } from "zod";

const Fail = z.object({ ok: z.literal(false), error: z.string() });
const Ok = z.object({ ok: z.literal(true) });

export const PublicFileSchema = z.object({
  id: z.string(),
  projectKey: z.string(),
  name: z.string(),
  createdAt: z.number(),
  lastAgentId: z.string().nullable(),
});
export type PublicFile = z.output<typeof PublicFileSchema>;

export const BridgeStatusNameSchema = z.enum(["stopped", "starting", "running", "failed"]);

export const FileRowSchema = PublicFileSchema.extend({
  status: BridgeStatusNameSchema,
  error: z.string().nullable(),
  outOfStep: z.boolean(),
});
export type FileRow = z.output<typeof FileRowSchema>;

export const TokensStateSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("none") }),
  z.object({ status: z.literal("imported"), warnings: z.array(z.string()) }),
  z.object({ status: z.literal("refused"), reason: z.string() }),
  z.object({ status: z.literal("written-back") }),
]);

export const designFilesRpc = defineRpc({
  name: "design.files.request",
  input: z.object({ workspaceId: z.string().min(1) }),
  output: z.union([
    z.object({ enabled: z.literal(true), files: z.array(FileRowSchema) }),
    z.object({ enabled: z.literal(false), reason: z.string() }),
  ]),
});

const FileResult = z.union([z.object({ ok: z.literal(true), file: PublicFileSchema }), Fail]);
export const createFileRpc = defineRpc({
  name: "design.create.request",
  input: z.object({ workspaceId: z.string().min(1), name: z.string().trim().min(1).max(80) }),
  output: FileResult,
});
export const renameFileRpc = defineRpc({
  name: "design.rename.request",
  input: z.object({ fileId: z.string().min(1), name: z.string().trim().min(1).max(80) }),
  output: FileResult,
});
export const removeFileRpc = defineRpc({
  name: "design.remove.request",
  input: z.object({ fileId: z.string().min(1) }),
  output: z.union([Ok, Fail]),
});
export const editorLinkRpc = defineRpc({
  name: "design.editor_link.request",
  input: z.object({ fileId: z.string().min(1), workspaceId: z.string().min(1) }),
  output: z.union([z.object({ ok: z.literal(true), url: z.string() }), Fail]),
});
export const addCommentRpc = defineRpc({
  name: "design.comment.request",
  input: z.object({
    fileId: z.string().min(1),
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    text: z.string().trim().min(1).max(2000),
  }),
  output: z.union([Ok, Fail]),
});
export const sendRpc = defineRpc({
  name: "design.send.request",
  input: z.object({
    fileId: z.string().min(1),
    agentId: z.string().min(1),
    note: z.string().max(4000),
  }),
  output: z.union([Ok, Fail]),
});
export const agentsRpc = defineRpc({
  name: "design.agents.request",
  input: z.object({ workspaceId: z.string().min(1) }),
  output: z.object({ agents: z.array(z.object({ id: z.string(), title: z.string() })) }),
});

export const ViewEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("status"),
    status: BridgeStatusNameSchema,
    error: z.string().nullable(),
  }),
  z.object({ type: z.literal("picture"), seq: z.number().int(), uri: z.string() }),
  z.object({ type: z.literal("tokens"), tokens: TokensStateSchema }),
  z.object({
    type: z.literal("threads"),
    threads: z.array(z.object({ id: z.string(), author: z.string(), preview: z.string() })),
  }),
  z.object({ type: z.literal("tokens-written") }),
]);
export type ViewEvent = z.output<typeof ViewEventSchema>;

export const viewSubscription = defineSubscription({
  name: "design.view",
  input: z.object({
    fileId: z.string().min(1),
    workspaceId: z.string().min(1),
    pictures: z.boolean(),
    /** Changes to restart the view after a failure. */
    attempt: z.number().int().optional(),
  }),
  event: ViewEventSchema,
});
```

- [ ] **Step 2: Failing service tests**

`design.test.ts` builds the service with the fake FigCraft (as the CLI, through `node`), a temp `PASEO_HOME`, a temp workspace directory with `design/tokens.json`, and a fake `paseo` holding one workspace and two agents. Use a manual clock (copy `fakeClock` from `bridges.test.ts`). Each test below is one `it`:

```ts
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createDesignService } from "./design.js";

const FAKE = new URL("../test/fake-figcraft.mjs", import.meta.url).pathname;

function fakePaseo(dir: string) {
  const sent: { agentId: string; text: string; options: unknown }[] = [];
  return {
    sent,
    paseo: {
      workspaces: {
        ref: () => ({ refresh: async () => ({ id: "w1", projectId: "p1", directory: dir }) }),
      },
      agents: {
        list: async () => ({
          entries: [
            { id: "a1", workspaceId: "w1", title: "Builder", archivedAt: null, status: "idle" },
            { id: "a2", workspaceId: "w2", title: "Other", archivedAt: null, status: "idle" },
          ],
        }),
        ref: (agentId: string) => ({
          refresh: async () => ({
            agent: { id: agentId, status: "idle", pendingPermissions: [], archivedAt: null },
          }),
          send: async (text: string, options: unknown) => {
            sent.push({ agentId, text, options });
          },
        }),
      },
    },
  };
}

function setup(env: Record<string, string> = {}) {
  const home = mkdtempSync(join(tmpdir(), "design-home-"));
  const work = mkdtempSync(join(tmpdir(), "design-work-"));
  mkdirSync(join(work, "design"));
  writeFileSync(
    join(work, "design", "tokens.json"),
    JSON.stringify({ color: { $type: "color", accent: { $value: "#3366cc" } } }),
  );
  const { paseo, sent } = fakePaseo(work);
  const lines: string[] = [];
  const service = createDesignService({
    config: {
      serverUrl: "wss://figcraft.example/",
      webUrl: "https://figcraft.example/app/",
      serverKey: "SERVERKEY",
      cliPath: FAKE,
      maxBridges: 3,
    },
    env: { PASEO_HOME: home, ...env },
    home,
    cliCommand: { command: process.execPath, argsBefore: [FAKE] },
    paseo: () => paseo as never,
    log: (line) => lines.push(line),
  });
  return { service, work, home, sent, lines };
}

describe("design service", () => {
  it("creates a file on the server and lists it for its project with no secrets", async () => {
    const { service } = setup();
    const created = await service.create("w1", "Login");
    expect(created).toMatchObject({ ok: true, file: { name: "Login", projectKey: "p1" } });
    const listed = await service.files("w1");
    expect(listed).toMatchObject({
      enabled: true,
      files: [{ name: "Login", status: "stopped", outOfStep: false }],
    });
    expect(JSON.stringify(listed)).not.toMatch(/token=|key=|editLink|ownerToken/);
  });
  it("gives the editor tab the web build's join URL, and nothing else carries it", async () => {
    const { service } = setup();
    const created = await service.create("w1", "Login");
    if (!created.ok) throw new Error(created.error);
    const link = await service.editorLink(created.file.id, "w1");
    expect(link).toMatchObject({
      ok: true,
      url: expect.stringMatching(/^https:\/\/figcraft\.example\/app\/#join=/),
    });
  });
  it("design_join returns the edit link to the agent, records it as the file's agent and holds the bridge", async () => {
    const { service } = setup();
    const result = await service.join({ id: "a1", workspaceId: "w1", cwd: "/x" } as never, {
      name: "Card",
    });
    expect(result.text).toContain("collab.join");
    expect(await service.files("w1")).toMatchObject({
      files: [{ name: "Card", lastAgentId: "a1", status: "running" }],
    });
  });
  it("adds the guarded FigCraft MCP server and the design_join tool to an interactive session", async () => {
    const { service, home } = setup();
    const request = {
      agentId: "a1",
      workspaceId: "w1",
      cwd: "/x",
      purpose: "interactive",
      tools: [],
      env: {},
      mcpServers: {},
    };
    const next = await service.openSession(request as never);
    expect(next?.tools.map((t) => t.name)).toEqual(["design_join"]);
    expect(next?.mcpServers.figcraft).toMatchObject({
      type: "stdio",
      command: process.execPath,
      args: expect.arrayContaining([
        "--server",
        "wss://figcraft.example/",
        "--automation-write-root",
        join(home, "design", "scratch", "p1"),
      ]),
    });
    expect(JSON.stringify(next)).not.toContain("SERVERKEY");
  });
  it("adds nothing to a history session or a session with no workspace", async () => {
    const { service } = setup();
    expect(
      await service.openSession({
        purpose: "history",
        workspaceId: "w1",
        tools: [],
        mcpServers: {},
      } as never),
    ).toBeNull();
    expect(
      await service.openSession({
        purpose: "interactive",
        workspaceId: null,
        tools: [],
        mcpServers: {},
      } as never),
    ).toBeNull();
  });
  it("Send to agent sends the note, code and picture to the chosen agent without cutting its turn", async () => {
    const { service, sent } = setup({ FAKE_FIGCRAFT_SELECTION: "n1" });
    const created = await service.create("w1", "Login");
    if (!created.ok) throw new Error(created.error);
    await service.editorLink(created.file.id, "w1");
    const result = await service.send(created.file.id, "a1", "build this");
    expect(result).toEqual({ ok: true });
    expect(sent[0]).toMatchObject({
      agentId: "a1",
      options: {
        activeTurnBehavior: "steer",
        images: [expect.objectContaining({ mimeType: "image/png" })],
      },
    });
  });
  it("lists only the workspace's own agents for the picker", async () => {
    const { service } = setup();
    expect(await service.agents("w1")).toEqual({ agents: [{ id: "a1", title: "Builder" }] });
  });
  it("is off and says why when the config is missing", async () => {
    const service = createDesignService({
      config: { disabled: "FIGCRAFT_URL is not set on this host" },
    } as never);
    expect(await service.files("w1")).toEqual({
      enabled: false,
      reason: "FIGCRAFT_URL is not set on this host",
    });
    expect(
      await service.openSession({
        purpose: "interactive",
        workspaceId: "w1",
        tools: [],
        mcpServers: {},
      } as never),
    ).toBeNull();
  });
  it("never logs the server key or a link", async () => {
    const { service, lines } = setup();
    await service.create("w1", "Login");
    expect(lines.join("\n")).not.toMatch(/SERVERKEY|token=/);
  });
  it("writes FigCraft token edits to design/tokens.json uncommitted on a tick", async () => {
    // Use the bridge test's approach: change the variables through FigCraft, then tick.
    const { service, work } = setup();
    const created = await service.create("w1", "Login");
    if (!created.ok) throw new Error(created.error);
    await service.editorLink(created.file.id, "w1");
    await service.debugImportVariables(created.file.id, {
      meta: {
        variableCollections: {
          "c:tokens": {
            id: "c:tokens",
            name: "Tokens",
            modes: [{ modeId: "m:default", name: "Default" }],
            defaultModeId: "m:default",
            variableIds: ["v:color/accent"],
          },
        },
        variables: {
          "v:color/accent": {
            id: "v:color/accent",
            name: "color/accent",
            variableCollectionId: "c:tokens",
            resolvedType: "COLOR",
            valuesByMode: { "m:default": { r: 1, g: 0, b: 0, a: 1 } },
          },
        },
      },
    });
    await service.tick();
    expect(JSON.parse(readFileSync(join(work, "design", "tokens.json"), "utf8"))).toEqual({
      color: { $type: "color", accent: { $value: "#ff0000" } },
    });
  });
});
```

`debugImportVariables(fileId, json)` exists for this test only: it calls the running bridge's session `importVariables`. Mark it with a `/** Tests only. */` comment.

- [ ] **Step 3: Run, fail. Step 4: Implement `design.ts`**

```ts
import { randomUUID, createHash } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { PaseoApi } from "@getpaseo/client";
import type {
  AgentToolResult,
  PluginHookAgent,
  PluginSessionOpenRequest,
} from "@getpaseo/plugin/server";
import type { DesignConfig } from "../shared/config.js";
import type { FileRow, PublicFile, ViewEvent } from "../shared/contracts.js";
import { Bridge, type TokensPort } from "./bridge.js";
import { createBridges, type Bridges } from "./bridges.js";
import { createCommentRouter, type CommentRouter } from "./comments.js";
import { FigcraftSession } from "./figcraft-session.js";
import { createFilesStore, publicFile, type DesignFile, type FilesStore } from "./files-store.js";
import { designPaths, scratchDir, type DesignPaths } from "./paths.js";
import { sendSelection } from "./send-to-agent.js";
import type { TokenFile } from "./tokens.js";
import { designTools } from "./agent-tools.js";

const IDLE_MS = 5 * 60_000;
const GUARD = new URL("../bin/figcraft-guard.mjs", import.meta.url).pathname;

export interface DesignDeps {
  config: DesignConfig | { disabled: string };
  env: NodeJS.ProcessEnv;
  home: string;
  /** How to start figcraft-cli: the CLI itself, or node + the fake in tests. */
  cliCommand?: { command: string; argsBefore: string[] };
  paseo(): PaseoApi;
  log(line: string): void;
  clock?: { setTimeout(fn: () => void, ms: number): unknown; clearTimeout(handle: unknown): void };
}

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

export interface DesignService {
  files(
    workspaceId: string,
  ): Promise<{ enabled: true; files: FileRow[] } | { enabled: false; reason: string }>;
  create(workspaceId: string, name: string): Promise<Result<{ file: PublicFile }>>;
  rename(fileId: string, name: string): Promise<Result<{ file: PublicFile }>>;
  remove(fileId: string): Promise<Result>;
  editorLink(fileId: string, workspaceId: string): Promise<Result<{ url: string }>>;
  comment(fileId: string, x: number, y: number, text: string): Promise<Result>;
  send(fileId: string, agentId: string, note: string): Promise<Result>;
  agents(workspaceId: string): Promise<{ agents: { id: string; title: string }[] }>;
  view(
    input: { fileId: string; workspaceId: string; pictures: boolean },
    push: (event: ViewEvent) => Promise<void>,
    signal: AbortSignal,
  ): Promise<void>;
  join(agent: PluginHookAgent, input: { file?: string; name?: string }): Promise<AgentToolResult>;
  openSession(request: PluginSessionOpenRequest): Promise<PluginSessionOpenRequest | null>;
  turnEnded(agentId: string): Promise<void>;
  agentGone(agentId: string): void;
  /** Every 10 s: comments to agents, token edits back to the repo. */
  tick(): Promise<void>;
  /** Tests only. */
  debugImportVariables(fileId: string, json: unknown): Promise<void>;
  stop(): Promise<void>;
}

function disabledService(reason: string): DesignService {
  const off = { ok: false as const, error: reason };
  return {
    files: async () => ({ enabled: false, reason }),
    create: async () => off,
    rename: async () => off,
    remove: async () => off,
    editorLink: async () => off,
    comment: async () => off,
    send: async () => off,
    agents: async () => ({ agents: [] }),
    view: async (_input, push) => {
      await push({ type: "status", status: "failed", error: reason });
    },
    join: async () => ({ isError: true, text: `Design mode is off: ${reason}` }),
    openSession: async () => null,
    turnEnded: async () => {},
    agentGone: () => {},
    tick: async () => {},
    debugImportVariables: async () => {},
    stop: async () => {},
  };
}

export function createDesignService(deps: DesignDeps): DesignService {
  if ("disabled" in deps.config) return disabledService(deps.config.disabled);
  const config = deps.config;
  const paths: DesignPaths = designPaths(deps.env, deps.home);
  const store: FilesStore = createFilesStore({ file: paths.filesJson, log: deps.log });
  const cli = deps.cliCommand ?? { command: config.cliPath, argsBefore: [] };
  /** The workspace directory each running file reads its tokens from (its first opener's). */
  const tokenDirs = new Map<string, string>();
  const viewers = new Map<string, Set<(event: ViewEvent) => Promise<void>>>();
  const serverWithKey = `${config.serverUrl}${config.serverUrl.includes("?") ? "&" : "?"}key=${encodeURIComponent(config.serverKey)}`;

  async function workspace(
    workspaceId: string,
  ): Promise<{ projectKey: string; directory: string | null }> {
    const snapshot = await deps.paseo().workspaces.ref(workspaceId).refresh();
    if (!snapshot) throw new Error(`No workspace ${workspaceId}`);
    return { projectKey: snapshot.projectId ?? snapshot.id, directory: snapshot.directory ?? null };
  }

  async function session(name: string): Promise<FigcraftSession> {
    mkdirSync(paths.runDir, { recursive: true });
    return FigcraftSession.start({
      command: cli.command,
      args: [...cli.argsBefore, "mcp"],
      env: { ...deps.env, FIGCRAFT_NO_SYSTEM_FONTS: "1" } as Record<string, string>,
      runDir: paths.runDir,
      name,
    });
  }

  function tokensPort(fileId: string): TokensPort {
    const file = () => {
      const dir = tokenDirs.get(fileId);
      return dir ? join(dir, "design", "tokens.json") : null;
    };
    return {
      async read() {
        const path = file();
        if (path === null || !existsSync(path)) return null;
        return JSON.parse(await readFile(path, "utf8")) as TokenFile;
      },
      async write(next) {
        const path = file();
        if (path === null) return;
        await writeFile(path, `${JSON.stringify(next, null, 2)}\n`);
        for (const push of viewers.get(fileId) ?? [])
          await push({ type: "tokens-written" }).catch(() => undefined);
      },
    };
  }

  const bridges: Bridges = createBridges({
    max: config.maxBridges,
    idleMs: IDLE_MS,
    clock: deps.clock ?? {
      setTimeout: (fn, ms) => setTimeout(fn, ms).unref(),
      clearTimeout: (h) => clearTimeout(h as NodeJS.Timeout),
    },
    log: deps.log,
    async openBridge(fileId) {
      const file = await store.get(fileId);
      if (!file) throw new Error("This design is no longer listed");
      return Bridge.open({
        session: await session(`bridge-${fileId}`),
        file,
        tokens: tokensPort(fileId),
        log: deps.log,
      });
    },
    onStatus(fileId, status) {
      for (const push of viewers.get(fileId) ?? []) {
        void push({
          type: "status",
          status: status.status,
          error: status.status === "failed" ? status.error : null,
        }).catch(() => undefined);
      }
    },
  });

  const comments: CommentRouter = createCommentRouter({
    openThreads: async (fileId) =>
      (
        await bridges
          .acquire(fileId, { kind: "viewer", id: "comments" })
          .finally(() => bridges.release(fileId, { kind: "viewer", id: "comments" }))
      ).openThreads(),
    prompt: async (fileId, ids) =>
      (
        await bridges
          .acquire(fileId, { kind: "viewer", id: "comments" })
          .finally(() => bridges.release(fileId, { kind: "viewer", id: "comments" }))
      ).commentPrompt(ids),
    agentOf: async (fileId) => (await store.get(fileId))?.lastAgentId ?? null,
    agentIdle: async (agentId) => {
      const result = await deps.paseo().agents.ref(agentId).refresh();
      const agent = result?.agent;
      return (
        !!agent &&
        !agent.archivedAt &&
        agent.pendingPermissions.length === 0 &&
        (agent.status === "idle" || agent.status === "error")
      );
    },
    send: (agentId, text) =>
      deps.paseo().agents.ref(agentId).send(text, { activeTurnBehavior: "steer" }),
    log: deps.log,
  });

  async function row(file: DesignFile): Promise<FileRow> {
    const status = bridges.status(file.id);
    let outOfStep = false;
    if (status.status === "running") {
      const bridge = await bridges.acquire(file.id, { kind: "viewer", id: "list" });
      try {
        outOfStep = await bridge.outOfStep();
      } catch {
        outOfStep = false;
      } finally {
        bridges.release(file.id, { kind: "viewer", id: "list" });
      }
    }
    return {
      ...publicFile(file),
      status: status.status,
      error: status.status === "failed" ? status.error : null,
      outOfStep,
    };
  }

  async function publishNew(projectKey: string, name: string): Promise<DesignFile> {
    const publisher = await session(`publish-${randomUUID().slice(0, 8)}`);
    try {
      const links = await publisher.publish(serverWithKey, name);
      const file: DesignFile = {
        id: randomUUID(),
        projectKey,
        name,
        createdAt: Date.now(),
        lastAgentId: null,
        secrets: { ...links },
      };
      await store.add(file);
      return file;
    } finally {
      await publisher.close();
    }
  }

  async function holdFor(
    fileId: string,
    workspaceId: string,
    holder: { kind: "viewer" | "agent"; id: string },
  ): Promise<Bridge> {
    if (!tokenDirs.has(fileId)) {
      const { directory } = await workspace(workspaceId);
      if (directory) tokenDirs.set(fileId, directory);
    }
    return bridges.acquire(fileId, holder);
  }

  const failure = (error: unknown) => ({ ok: false as const, error: (error as Error).message });

  const service: DesignService = {
    async files(workspaceId) {
      const { projectKey } = await workspace(workspaceId);
      return { enabled: true, files: await Promise.all((await store.list(projectKey)).map(row)) };
    },
    async create(workspaceId, name) {
      try {
        const { projectKey } = await workspace(workspaceId);
        return { ok: true, file: publicFile(await publishNew(projectKey, name)) };
      } catch (error) {
        deps.log(`[design] create failed: ${(error as Error).message}`);
        return failure(error);
      }
    },
    async rename(fileId, name) {
      try {
        return { ok: true, file: publicFile(await store.update(fileId, { name })) };
      } catch (error) {
        return failure(error);
      }
    },
    async remove(fileId) {
      try {
        comments.forget(fileId);
        await store.remove(fileId);
        return { ok: true };
      } catch (error) {
        return failure(error);
      }
    },
    async editorLink(fileId, workspaceId) {
      try {
        const file = await store.get(fileId);
        if (!file) return { ok: false, error: "This design is no longer listed" };
        await holdFor(fileId, workspaceId, { kind: "viewer", id: `editor-${fileId}` });
        return {
          ok: true,
          url: `${config.webUrl}#join=${encodeURIComponent(file.secrets.editLink)}`,
        };
      } catch (error) {
        return failure(error);
      }
    },
    async comment(fileId, x, y, text) {
      try {
        const bridge = await bridges.acquire(fileId, { kind: "viewer", id: "comment" });
        try {
          const bounds = (await bridge.pageBounds()) ?? { x: 0, y: 0, width: 1, height: 1 };
          await bridge.addComment(bounds.x + x * bounds.width, bounds.y + y * bounds.height, text);
        } finally {
          bridges.release(fileId, { kind: "viewer", id: "comment" });
        }
        return { ok: true };
      } catch (error) {
        return failure(error);
      }
    },
    async send(fileId, agentId, note) {
      const file = await store.get(fileId);
      if (!file) return { ok: false, error: "This design is no longer listed" };
      try {
        const bridge = await bridges.acquire(fileId, { kind: "viewer", id: "send" });
        try {
          const result = await sendSelection({
            bridge,
            file,
            agentId,
            note,
            send: (id, text, images) =>
              deps.paseo().agents.ref(id).send(text, { activeTurnBehavior: "steer", images }),
          });
          if (result.ok) await store.update(fileId, { lastAgentId: agentId });
          return result;
        } finally {
          bridges.release(fileId, { kind: "viewer", id: "send" });
        }
      } catch (error) {
        return failure(error);
      }
    },
    async agents(workspaceId) {
      const { entries } = await deps.paseo().agents.list();
      return {
        agents: entries
          .filter((agent) => agent.workspaceId === workspaceId && !agent.archivedAt)
          .map((agent) => ({ id: agent.id, title: agent.title ?? agent.id.slice(0, 8) })),
      };
    },
    async view(input, push, signal) {
      const holder = { kind: "viewer" as const, id: `view-${randomUUID()}` };
      const set = viewers.get(input.fileId) ?? new Set();
      set.add(push);
      viewers.set(input.fileId, set);
      let lastHash = "";
      let seq = 0;
      try {
        const bridge = await holdFor(input.fileId, input.workspaceId, holder);
        await push({ type: "status", status: "running", error: null });
        await push({ type: "tokens", tokens: bridge.tokens });
        while (!signal.aborted) {
          const threads = await bridge.openThreads().catch(() => []);
          await push({
            type: "threads",
            threads: threads.map(({ id, author, preview }) => ({ id, author, preview })),
          });
          if (input.pictures) {
            const picture = await bridge.picture().catch(() => null);
            if (picture) {
              const hash = createHash("sha1").update(picture.data).digest("hex");
              if (hash !== lastHash) {
                lastHash = hash;
                seq += 1;
                await push({
                  type: "picture",
                  seq,
                  uri: `data:${picture.mimeType};base64,${picture.data}`,
                });
              }
            }
          }
          await new Promise<void>((resolve) => {
            const timer = setTimeout(resolve, 3000);
            timer.unref();
            signal.addEventListener("abort", () => resolve(), { once: true });
          });
        }
      } catch (error) {
        await push({ type: "status", status: "failed", error: (error as Error).message }).catch(
          () => undefined,
        );
      } finally {
        set.delete(push);
        bridges.release(input.fileId, holder);
      }
    },
    async join(agent, input) {
      if (!agent.workspaceId)
        return { isError: true, text: "design_join needs an agent in a workspace" };
      try {
        const { projectKey } = await workspace(agent.workspaceId);
        let file = input.file ? await store.get(input.file) : null;
        if (input.file && (!file || file.projectKey !== projectKey)) {
          return { isError: true, text: `No design ${input.file} in this project` };
        }
        file ??= await publishNew(projectKey, input.name?.trim() || "Design");
        await holdFor(file.id, agent.workspaceId, { kind: "agent", id: agent.id });
        await store.update(file.id, { lastAgentId: agent.id });
        return {
          text: [
            `Design "${file.name}" (file ${file.id}) is open; its tokens are imported as FigCraft variables (collection Tokens).`,
            `Join it with FigCraft: run_command collab.join {"link": "${file.secrets.editLink}"}, then poll collab.peers until status is "live".`,
            "Use the Tokens variables for colours, sizes and type. Do not share, publish or host files: Paseo does that.",
            "Do not repeat this link in chat.",
          ].join("\n"),
        };
      } catch (error) {
        return { isError: true, text: `design_join failed: ${(error as Error).message}` };
      }
    },
    async openSession(request) {
      if (request.purpose !== "interactive" || !request.workspaceId) return null;
      const { projectKey, directory } = await workspace(request.workspaceId);
      const writeRoot = scratchDir(paths, projectKey);
      mkdirSync(writeRoot, { recursive: true });
      const designDir = directory ? join(directory, "design") : null;
      const args = [
        GUARD,
        "--server",
        config.serverUrl,
        "--",
        cli.command,
        ...cli.argsBefore,
        "mcp",
        "--automation-write-root",
        writeRoot,
        ...(designDir && existsSync(designDir) ? ["--automation-read-root", designDir] : []),
      ];
      return {
        ...request,
        tools: [...request.tools, ...designTools(service)],
        mcpServers: {
          ...request.mcpServers,
          figcraft: { type: "stdio", command: process.execPath, args },
        },
      };
    },
    turnEnded: (agentId) => comments.turnEnded(agentId),
    agentGone: (agentId) => bridges.releaseAgent(agentId),
    async tick() {
      for (const fileId of bridges.running()) {
        try {
          await comments.poll(fileId);
          const bridge = await bridges.acquire(fileId, { kind: "viewer", id: "tick" });
          try {
            await bridge.syncTokensBack();
          } finally {
            bridges.release(fileId, { kind: "viewer", id: "tick" });
          }
        } catch (error) {
          deps.log(`[design] ${fileId}: tick failed: ${(error as Error).message}`);
        }
      }
    },
    async debugImportVariables(fileId, json) {
      const bridge = await bridges.acquire(fileId, { kind: "viewer", id: "debug" });
      await (bridge as unknown as { session: FigcraftSession }).session.importVariables(json);
      bridges.release(fileId, { kind: "viewer", id: "debug" });
    },
    stop: () => bridges.stopAll(),
  };
  return service;
}
```

Notes for the implementer:

- `cli.command` when the CLI is the real one: `openSession` puts `config.cliPath` after `--`. In tests `cliCommand` is `node` + the fake, so the guard runs `node fake-figcraft.mjs mcp ...`; the fake ignores its arguments.
- The `comments` port's `openThreads` and `prompt` acquire and release the bridge only around the call so they never keep a file open on their own.
- In `view`, a viewer with `pictures: false` (the desktop editor tab) still gets status, tokens and threads.

- [ ] **Step 5: `agent-tools.ts`, test first**

`agent-tools.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { designTools } from "./agent-tools.js";

describe("design_join", () => {
  it("is one tool that passes the agent and input to the service", async () => {
    const calls: unknown[] = [];
    const [tool] = designTools({
      join: async (agent: unknown, input: unknown) => (calls.push([agent, input]), { text: "ok" }),
    } as never);
    expect(tool.name).toBe("design_join");
    const agent = { id: "a1", workspaceId: "w1" };
    expect(await tool.execute({ name: "Card" }, { agent } as never)).toEqual({ text: "ok" });
    expect(calls).toEqual([[agent, { name: "Card" }]]);
  });
});
```

`agent-tools.ts`:

```ts
import { defineAgentTool, type AgentToolDefinition } from "@getpaseo/plugin/server";
import { z } from "zod";
import type { DesignService } from "./design.js";

export const JoinInputSchema = z.object({
  file: z.string().min(1).optional(),
  name: z.string().min(1).max(80).optional(),
});

export function designTools(service: Pick<DesignService, "join">): AgentToolDefinition[] {
  return [
    defineAgentTool({
      name: "design_join",
      description:
        "Open a design in FigCraft for this workspace's project: pass file (an id from a Send to agent prompt or an earlier design_join) to open it, or name to start a new one. Returns how to join it with your FigCraft tools. The project's design/tokens.json is loaded as variables.",
      input: JoinInputSchema,
      execute: (input, { agent }) => service.join(agent, input),
    }),
  ];
}
```

- [ ] **Step 6: Wire `index.server.ts`**

```ts
import { homedir } from "node:os";
import type { PaseoApi } from "@getpaseo/client";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import { readDesignConfig } from "./shared/config.js";
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

const TICK_MS = 10_000;

export default function contribute(server: PluginServerContext): () => Promise<void> {
  const log = (line: string) => console.error(line);
  let paseo: PaseoApi | null = null;
  const remember = (context: { paseo: PaseoApi }) => {
    paseo = context.paseo;
  };
  // Built-ins run in the daemon process, so process.env is the daemon's env.
  const service = createDesignService({
    config: readDesignConfig(process.env),
    env: process.env,
    home: homedir(),
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
      remember(context),
      service.comment(input.fileId, input.x, input.y, input.text)
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
```

- [ ] **Step 7: Run the service and tool tests, then every design test file, typecheck, lint, commit**

Run: `flock -w 480 /tmp/paseo-heavy.lock npx vitest run plugins/design --no-file-parallelism --maxWorkers=1` → all pass (the real test skipped).
Run the plugins typecheck and `npm run lint -- plugins/design`.
Commit `feat(fork): design service, design_join and the daemon wiring` with `plugins/design/shared/contracts.ts plugins/design/server/design.ts plugins/design/server/design.test.ts plugins/design/server/agent-tools.ts plugins/design/server/agent-tools.test.ts plugins/design/index.server.ts`.

---

### Task 12: Designs panel

Design work: load the installed design skills (`unslop` polish mode, `antislop-ui`, `antislop-human`, `antislop-layoutmobile`) and `docs/design.md` before writing styles. Phone width (390 x 844) first, then 820 x 1180 and 1440 x 900, light and dark.

**Files:**

- Create: `plugins/design/client/styles.ts`, `plugins/design/client/designs-panel.tsx`, `plugins/design/client/model.ts`, `plugins/design/client/model.test.ts`
- Modify: `plugins/design/index.client.tsx`

**Interfaces:**

- Consumes: `designFilesRpc`, `createFileRpc`, `renameFileRpc`, `removeFileRpc` (Task 11).
- Produces: `DesignsPanel` (a `PluginWorkspacePanelProps` component), `rowLabel(row: FileRow): { title: string; detail: string; tone: "muted" | "warning" | "danger" }` in `model.ts`.

- [ ] **Step 1: Failing model test**

```ts
import { describe, expect, it } from "vitest";
import { rowLabel } from "./model.js";

const base = {
  id: "f1",
  projectKey: "p",
  name: "Login",
  createdAt: 0,
  lastAgentId: null,
  status: "stopped" as const,
  error: null,
  outOfStep: false,
};

describe("rowLabel", () => {
  it("says closed, open, opening and failed in words", () => {
    expect(rowLabel(base)).toEqual({ title: "Login", detail: "Closed", tone: "muted" });
    expect(rowLabel({ ...base, status: "running" })).toEqual({
      title: "Login",
      detail: "Open",
      tone: "muted",
    });
    expect(rowLabel({ ...base, status: "starting" })).toEqual({
      title: "Login",
      detail: "Opening",
      tone: "muted",
    });
    expect(rowLabel({ ...base, status: "failed", error: "Bridge stopped: exited with 3" })).toEqual(
      {
        title: "Login",
        detail: "Bridge stopped: exited with 3",
        tone: "danger",
      },
    );
  });
  it("marks a file whose variables differ from design/tokens.json", () => {
    expect(rowLabel({ ...base, status: "running", outOfStep: true })).toEqual({
      title: "Login",
      detail: "Open · tokens differ from design/tokens.json",
      tone: "warning",
    });
  });
});
```

- [ ] **Step 2: Run, fail. Step 3: `model.ts`**

```ts
import type { FileRow } from "../shared/contracts.js";

const STATUS: Record<FileRow["status"], string> = {
  stopped: "Closed",
  starting: "Opening",
  running: "Open",
  failed: "Failed",
};

export function rowLabel(row: FileRow): {
  title: string;
  detail: string;
  tone: "muted" | "warning" | "danger";
} {
  if (row.status === "failed")
    return { title: row.name, detail: row.error ?? "Failed", tone: "danger" };
  if (row.outOfStep)
    return {
      title: row.name,
      detail: `${STATUS[row.status]} · tokens differ from design/tokens.json`,
      tone: "warning",
    };
  return { title: row.name, detail: STATUS[row.status], tone: "muted" };
}
```

- [ ] **Step 4: Styles** (`styles.ts`): one `designStyles(theme: PluginTheme)` returning `StyleSheet.create`-free plain objects, as `plugins/office/client/styles.ts` does: `screen` (flex 1, `backgroundColor: theme.colors.surface0`), `header` (row, padding 16, gap 8, `justifyContent: "space-between"`), `title` (16/500, `foreground`), `row` (minHeight 56, paddingHorizontal 16, paddingVertical 8, borderBottomWidth 1, `borderColor: theme.colors.border`), `rowTitle` (15/500 `foreground`), `detailMuted` (13 `foregroundMuted`), `detailWarning` (13 `statusWarning`), `detailDanger` (13 `statusDanger`), `button` (minHeight 44, paddingHorizontal 16, radius 8, borderWidth 1, `borderColor: theme.colors.border`, `backgroundColor: theme.colors.surface1`), `buttonLabel` (14/500 `foreground`), `empty` (padding 24, 14 `foregroundMuted`), `input` (minHeight 44, borderWidth 1, radius 8, paddingHorizontal 12, `color: foreground`, `borderColor: border`). Every touch target is at least 44 px; check text contrast with `python3 /home/paseo/.claude/skills/antislop-human/contrast-check.py <fg> <bg>` for the light and dark palettes the harness gives (`foregroundMuted` on `surface0` must reach 4.5:1).

- [ ] **Step 5: `designs-panel.tsx`**

```tsx
import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useRpc, type PluginWorkspacePanelProps } from "@getpaseo/plugin/client";
import { Modal, ScrollView, TextInput, useToast } from "@getpaseo/plugin/client/ui";
import {
  createFileRpc,
  designFilesRpc,
  removeFileRpc,
  renameFileRpc,
  type FileRow,
} from "../shared/contracts.js";
import { EditorView } from "./editor-view.js";
import { rowLabel } from "./model.js";
import { designStyles } from "./styles.js";

type Listing =
  | { status: "loading" }
  | { status: "off"; reason: string }
  | { status: "ready"; files: FileRow[] }
  | { status: "error"; error: string };

export function DesignsPanel(props: PluginWorkspacePanelProps) {
  const { workspaceId, theme } = props;
  const styles = useMemo(() => designStyles(theme), [theme]);
  const toast = useToast();
  const list = useRpc(designFilesRpc);
  const create = useRpc(createFileRpc);
  const rename = useRpc(renameFileRpc);
  const remove = useRpc(removeFileRpc);
  const [listing, setListing] = useState<Listing>({ status: "loading" });
  const [open, setOpen] = useState<FileRow | null>(null);
  const [naming, setNaming] = useState<{ mode: "new" } | { mode: "rename"; file: FileRow } | null>(
    null,
  );
  const [name, setName] = useState("");

  const reload = useCallback(async () => {
    try {
      const result = await list({ workspaceId });
      setListing(
        result.enabled
          ? { status: "ready", files: result.files }
          : { status: "off", reason: result.reason },
      );
    } catch (error) {
      setListing({ status: "error", error: (error as Error).message });
    }
  }, [list, workspaceId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const submitName = useCallback(async () => {
    if (naming === null || name.trim() === "") return;
    const result =
      naming.mode === "new"
        ? await create({ workspaceId, name })
        : await rename({ fileId: naming.file.id, name });
    if (!result.ok) toast.show({ title: result.error, variant: "error" });
    setNaming(null);
    setName("");
    await reload();
  }, [create, name, naming, reload, rename, toast, workspaceId]);

  if (open !== null) {
    return <EditorView {...props} file={open} onClose={() => (setOpen(null), void reload())} />;
  }

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Text style={styles.title} accessibilityRole="header">
          Designs
        </Text>
        {listing.status === "ready" ? (
          <Pressable
            style={styles.button}
            accessibilityRole="button"
            onPress={() => setNaming({ mode: "new" })}
          >
            <Text style={styles.buttonLabel}>New design</Text>
          </Pressable>
        ) : null}
      </View>
      {listing.status === "loading" ? <Text style={styles.empty}>Loading designs</Text> : null}
      {listing.status === "off" ? (
        <Text style={styles.empty}>Design mode is off: {listing.reason}</Text>
      ) : null}
      {listing.status === "error" ? (
        <Text style={styles.empty}>Designs could not be read: {listing.error}</Text>
      ) : null}
      {listing.status === "ready" && listing.files.length === 0 ? (
        <Text style={styles.empty}>
          No designs for this project yet. Start one, or ask an agent to design a screen.
        </Text>
      ) : null}
      {listing.status === "ready" ? (
        <ScrollView>
          {listing.files.map((file) => {
            const label = rowLabel(file);
            const detailStyle =
              label.tone === "danger"
                ? styles.detailDanger
                : label.tone === "warning"
                  ? styles.detailWarning
                  : styles.detailMuted;
            return (
              <View key={file.id} style={styles.row}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Open ${file.name}`}
                  onPress={() => setOpen(file)}
                  style={{ flex: 1, minHeight: 44, justifyContent: "center" }}
                >
                  <Text style={styles.rowTitle}>{label.title}</Text>
                  <Text style={detailStyle}>{label.detail}</Text>
                </Pressable>
                <Pressable
                  style={styles.button}
                  accessibilityRole="button"
                  accessibilityLabel={`Rename ${file.name}`}
                  onPress={() => (setName(file.name), setNaming({ mode: "rename", file }))}
                >
                  <Text style={styles.buttonLabel}>Rename</Text>
                </Pressable>
                <Pressable
                  style={styles.button}
                  accessibilityRole="button"
                  accessibilityLabel={`Remove ${file.name} from Paseo`}
                  onPress={async () => {
                    const result = await remove({ fileId: file.id });
                    if (!result.ok) toast.show({ title: result.error, variant: "error" });
                    await reload();
                  }}
                >
                  <Text style={styles.buttonLabel}>Remove</Text>
                </Pressable>
              </View>
            );
          })}
        </ScrollView>
      ) : null}
      <Modal
        visible={naming !== null}
        onRequestClose={() => setNaming(null)}
        title={naming?.mode === "rename" ? "Rename design" : "New design"}
      >
        <TextInput
          style={styles.input}
          value={name}
          onChangeText={setName}
          placeholder="Name"
          autoFocus
          onSubmitEditing={() => void submitName()}
          maxLength={80}
        />
        <Pressable
          style={styles.button}
          accessibilityRole="button"
          onPress={() => void submitName()}
        >
          <Text style={styles.buttonLabel}>{naming?.mode === "rename" ? "Rename" : "Create"}</Text>
        </Pressable>
      </Modal>
    </View>
  );
}
```

Read `ModalProps` in `packages/plugin/src/client/ui.ts` before using `Modal`: use its real prop names (`visible`/`onRequestClose`/`title` above follow the office's `board-sheet.tsx`; copy that file's usage exactly). `useToast().show` likewise: copy the call shape from an existing plugin (`grep -rn "useToast" plugins/*/client`).

- [ ] **Step 6: Contribute the panel** in `index.client.tsx`:

```tsx
import type { PluginClientContext } from "@getpaseo/plugin/client";
import { DesignsPanel } from "./client/designs-panel.js";

const PANEL_ID = "designs";
const ICON = "PenTool";

export default function contribute(client: PluginClientContext) {
  const removers = [
    client.addWorkspacePanel({
      id: PANEL_ID,
      title: "Designs",
      icon: ICON,
      Component: DesignsPanel,
    }),
    client.addCommandCenterItem({
      id: "open-designs",
      title: "Open designs",
      icon: ICON,
      context: "workspace",
      onSelect({ openPanel }) {
        openPanel(PANEL_ID);
      },
    }),
  ];
  return () => {
    for (const remove of removers) void remove();
  };
}
```

Check `PenTool` is in the plugin icon set (`grep -n "PenTool" packages/plugin/src/icons.ts`); if not, use `Palette` or the closest name it lists.

- [ ] **Step 7: Run model test, typecheck, lint; commit** `feat(fork): designs panel per workspace` (EditorView comes in Task 13: commit Tasks 12 and 13 together if the import does not typecheck alone, or stub `editor-view.tsx` with `export function EditorView() { return null; }` and replace it in Task 13).

---

### Task 13: Editor view (desktop editor, phone picture with comments) and Send to agent

**Files:**

- Create: `plugins/design/client/editor-view.tsx`, `plugins/design/client/send-sheet.tsx`, `plugins/design/client/tap.ts`, `plugins/design/client/tap.test.ts`

**Interfaces:**

- Consumes: `viewSubscription`, `editorLinkRpc`, `addCommentRpc`, `sendRpc`, `agentsRpc`.
- Produces: `EditorView(props: PluginWorkspacePanelProps & { file: FileRow; onClose(): void })`, `tapToPicture(tap: { x: number; y: number }, frame: { width: number; height: number }, picture: { width: number; height: number }): { x: number; y: number } | null` (0..1 inside the picture shown with `resizeMode="contain"`, null outside it).

- [ ] **Step 1: Failing tap test**

```ts
import { describe, expect, it } from "vitest";
import { tapToPicture } from "./tap.js";

describe("tapToPicture", () => {
  it("maps a tap to the picture shown contained in its frame", () => {
    // 400x200 picture in a 200x200 frame: drawn 200x100, 50 px bands above and below.
    expect(
      tapToPicture({ x: 100, y: 100 }, { width: 200, height: 200 }, { width: 400, height: 200 }),
    ).toEqual({ x: 0.5, y: 0.5 });
    expect(
      tapToPicture({ x: 0, y: 50 }, { width: 200, height: 200 }, { width: 400, height: 200 }),
    ).toEqual({ x: 0, y: 0 });
  });
  it("ignores a tap on the empty band", () => {
    expect(
      tapToPicture({ x: 100, y: 10 }, { width: 200, height: 200 }, { width: 400, height: 200 }),
    ).toBeNull();
  });
});
```

- [ ] **Step 2: Run, fail. Step 3: `tap.ts`**

```ts
export function tapToPicture(
  tap: { x: number; y: number },
  frame: { width: number; height: number },
  picture: { width: number; height: number },
): { x: number; y: number } | null {
  const scale = Math.min(frame.width / picture.width, frame.height / picture.height);
  const width = picture.width * scale;
  const height = picture.height * scale;
  const left = (frame.width - width) / 2;
  const top = (frame.height - height) / 2;
  const x = (tap.x - left) / width;
  const y = (tap.y - top) / height;
  if (x < 0 || x > 1 || y < 0 || y > 1) return null;
  return { x, y };
}
```

- [ ] **Step 4: `send-sheet.tsx`** — a `Modal` titled "Send to agent" with: the workspace's agents as chips (from `agentsRpc`, the file's `lastAgentId` chosen first; a chosen chip has a 2 px outline, others 1 px, padding giving the pixel back, as the office's chips do), a `TextInput` note (multiline, max 4000, placeholder "What should the agent do with it?"), and a full-width "Send" button that calls `sendRpc` and shows the error under the button when `ok` is false ("Select a frame or layers in the design first" is the usual one), and closes on success with a toast "Sent to <agent title>". No agent in the workspace: the sheet says "No agent in this workspace. Start one, then send." and Send is disabled.

```tsx
import { useEffect, useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useRpc, type PluginTheme } from "@getpaseo/plugin/client";
import { Modal, ScrollView, TextInput, useToast } from "@getpaseo/plugin/client/ui";
import { agentsRpc, sendRpc, type FileRow } from "../shared/contracts.js";
import { designStyles } from "./styles.js";

export function SendSheet(props: {
  visible: boolean;
  onClose(): void;
  workspaceId: string;
  file: FileRow;
  theme: PluginTheme;
}) {
  const styles = useMemo(() => designStyles(props.theme), [props.theme]);
  const agentsCall = useRpc(agentsRpc);
  const send = useRpc(sendRpc);
  const toast = useToast();
  const [agents, setAgents] = useState<{ id: string; title: string }[]>([]);
  const [chosen, setChosen] = useState<string | null>(props.file.lastAgentId);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!props.visible) return;
    void agentsCall({ workspaceId: props.workspaceId }).then((result) => {
      setAgents(result.agents);
      setChosen((current) => current ?? result.agents[0]?.id ?? null);
    });
  }, [agentsCall, props.visible, props.workspaceId]);

  async function submit() {
    if (chosen === null) return;
    setSending(true);
    setError(null);
    const result = await send({ fileId: props.file.id, agentId: chosen, note });
    setSending(false);
    if (!result.ok) return setError(result.error);
    toast.show({
      title: `Sent to ${agents.find((a) => a.id === chosen)?.title ?? "the agent"}`,
      variant: "success",
    });
    setNote("");
    props.onClose();
  }

  return (
    <Modal visible={props.visible} onRequestClose={props.onClose} title="Send to agent">
      {agents.length === 0 ? (
        <Text style={styles.empty}>No agent in this workspace. Start one, then send.</Text>
      ) : null}
      <ScrollView horizontal>
        {agents.map((agent) => (
          <Pressable
            key={agent.id}
            accessibilityRole="button"
            accessibilityState={{ selected: agent.id === chosen }}
            onPress={() => setChosen(agent.id)}
            style={agent.id === chosen ? styles.chipSelected : styles.chip}
          >
            <Text style={styles.buttonLabel}>{agent.title}</Text>
          </Pressable>
        ))}
      </ScrollView>
      <TextInput
        style={styles.input}
        value={note}
        onChangeText={setNote}
        placeholder="What should the agent do with it?"
        multiline
        maxLength={4000}
      />
      {error ? <Text style={styles.detailDanger}>{error}</Text> : null}
      <Pressable
        style={styles.button}
        accessibilityRole="button"
        accessibilityState={{ disabled: chosen === null || sending }}
        disabled={chosen === null || sending}
        onPress={() => void submit()}
      >
        <Text style={styles.buttonLabel}>{sending ? "Sending" : "Send"}</Text>
      </Pressable>
    </Modal>
  );
}
```

Add `chip` and `chipSelected` to `designStyles` (minHeight 44, paddingHorizontal 16 / 15, borderWidth 1 / 2, radius 8, `surface1` / `surface2`, `border` / `foregroundMuted`).

- [ ] **Step 5: `editor-view.tsx`**

- Header: back button ("Designs", 44 px), the file name, and on web a "Send to agent" button. On the phone the header has no Send button; Send lives on each thread row ("Send to agent" with the thread's text as the note, which asks the agent about that comment; the selection then is whatever the desktop user last selected, so on the phone the sheet's error tells the user to select on desktop when nothing is selected).
- Web (`layout.platform === "web"`): call `editorLinkRpc` once, then mount an iframe into a `View` found by `useId()` through `document.getElementById`, exactly like `plugins/office/client/scene/scene-view.tsx` lines 89-196 mount its canvas: `iframe.src = url`, `iframe.title = "FigCraft editor"`, `iframe.allow = "clipboard-read; clipboard-write"`, `iframe.style` fills the view, no `sandbox` attribute (FigCraft needs scripts, same-origin storage and popups; see its embedding guide). Remove the iframe in the effect's cleanup. Subscribe to `viewSubscription` with `pictures: false` for status, tokens and threads.
- Native: subscribe with `pictures: true`; show the latest `picture` event's `uri` in an `Image` with `resizeMode="contain"` inside a `Pressable` measured with `onLayout`; on press, `tapToPicture` the event's `locationX/Y` (the picture's own size from `Image.getSize(uri, ...)`), then open a small `Modal` "Add comment" with a `TextInput` and "Comment" button that calls `addCommentRpc`. Below the picture, the open threads (author, preview) in a `ScrollView`.
- Both: a banner under the header for `tokens` events: `refused` → "Tokens not loaded: <reason>" (warning tone); `imported` with warnings → "Tokens loaded, <n> kept out: <first warning>" (muted); `written-back` or a `tokens-written` event → "Token edits written to design/tokens.json (not committed)" (muted). Status `failed` → full-width message with the error and a "Try again" button that remounts the subscription (change a `key`).
- Every pressable has `accessibilityRole` and a label; every target is 44 px or more.

```tsx
import { useCallback, useEffect, useId, useMemo, useState } from "react";
import {
  Image,
  Pressable,
  Text,
  View,
  type GestureResponderEvent,
  type LayoutChangeEvent,
} from "react-native";
import { useRpc, useSubscription, type PluginWorkspacePanelProps } from "@getpaseo/plugin/client";
import { Modal, ScrollView, TextInput, useToast } from "@getpaseo/plugin/client/ui";
import {
  addCommentRpc,
  editorLinkRpc,
  viewSubscription,
  type FileRow,
  type ViewEvent,
} from "../shared/contracts.js";
import { SendSheet } from "./send-sheet.js";
import { designStyles } from "./styles.js";
import { tapToPicture } from "./tap.js";

type Tokens = Extract<ViewEvent, { type: "tokens" }>["tokens"];

function tokensBanner(
  tokens: Tokens | null,
  written: boolean,
): { text: string; warning: boolean } | null {
  if (written || tokens?.status === "written-back")
    return { text: "Token edits written to design/tokens.json (not committed)", warning: false };
  if (tokens?.status === "refused")
    return { text: `Tokens not loaded: ${tokens.reason}`, warning: true };
  if (tokens?.status === "imported" && tokens.warnings.length > 0) {
    return {
      text: `Tokens loaded, ${tokens.warnings.length} kept out: ${tokens.warnings[0]}`,
      warning: false,
    };
  }
  return null;
}

export function EditorView(props: PluginWorkspacePanelProps & { file: FileRow; onClose(): void }) {
  const { file, workspaceId, theme, layout } = props;
  const web = layout.platform === "web";
  const styles = useMemo(() => designStyles(theme), [theme]);
  const toast = useToast();
  const editorLink = useRpc(editorLinkRpc);
  const addComment = useRpc(addCommentRpc);
  const containerId = useId();
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState<{ status: string; error: string | null }>({
    status: "starting",
    error: null,
  });
  const [picture, setPicture] = useState<{ uri: string; width: number; height: number } | null>(
    null,
  );
  const [threads, setThreads] = useState<{ id: string; author: string; preview: string }[]>([]);
  const [tokens, setTokens] = useState<Tokens | null>(null);
  const [written, setWritten] = useState(false);
  const [frame, setFrame] = useState({ width: 0, height: 0 });
  const [draft, setDraft] = useState<{ x: number; y: number } | null>(null);
  const [comment, setComment] = useState("");
  const [sending, setSending] = useState<string | null>(null);

  const onEvent = useCallback((event: ViewEvent) => {
    if (event.type === "status") setStatus({ status: event.status, error: event.error });
    if (event.type === "tokens") setTokens(event.tokens);
    if (event.type === "tokens-written") setWritten(true);
    if (event.type === "threads") setThreads(event.threads);
    if (event.type === "picture") {
      Image.getSize(event.uri, (width, height) => setPicture({ uri: event.uri, width, height }));
    }
  }, []);
  useSubscription(
    viewSubscription,
    { fileId: file.id, workspaceId, pictures: !web, attempt },
    onEvent,
  );

  useEffect(() => {
    if (!web) return undefined;
    let iframe: HTMLIFrameElement | null = null;
    let cancelled = false;
    void editorLink({ fileId: file.id, workspaceId }).then((result) => {
      if (cancelled) return;
      if (!result.ok) return setStatus({ status: "failed", error: result.error });
      const container = document.getElementById(containerId);
      if (container === null) return;
      iframe = document.createElement("iframe");
      iframe.src = result.url;
      iframe.title = "FigCraft editor";
      iframe.allow = "clipboard-read; clipboard-write";
      Object.assign(iframe.style, { border: "0", width: "100%", height: "100%", display: "block" });
      container.appendChild(iframe);
    });
    return () => {
      cancelled = true;
      iframe?.remove();
    };
  }, [containerId, editorLink, file.id, web, workspaceId, attempt]);

  const banner = tokensBanner(tokens, written);

  async function submitComment() {
    if (draft === null || comment.trim() === "") return;
    const result = await addComment({ fileId: file.id, x: draft.x, y: draft.y, text: comment });
    if (!result.ok) toast.show({ title: result.error, variant: "error" });
    setDraft(null);
    setComment("");
  }

  function onTap(event: GestureResponderEvent) {
    if (picture === null) return;
    const point = tapToPicture(
      { x: event.nativeEvent.locationX, y: event.nativeEvent.locationY },
      frame,
      picture,
    );
    if (point !== null) setDraft(point);
  }

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Pressable
          style={styles.button}
          accessibilityRole="button"
          accessibilityLabel="Back to designs"
          onPress={props.onClose}
        >
          <Text style={styles.buttonLabel}>Designs</Text>
        </Pressable>
        <Text style={styles.title} numberOfLines={1}>
          {file.name}
        </Text>
        {web ? (
          <Pressable
            style={styles.button}
            accessibilityRole="button"
            onPress={() => setSending("")}
          >
            <Text style={styles.buttonLabel}>Send to agent</Text>
          </Pressable>
        ) : null}
      </View>
      {banner ? (
        <Text style={banner.warning ? styles.detailWarning : styles.detailMuted}>
          {banner.text}
        </Text>
      ) : null}
      {status.status === "failed" ? (
        <View style={styles.empty}>
          <Text style={styles.detailDanger}>{status.error}</Text>
          <Pressable
            style={styles.button}
            accessibilityRole="button"
            onPress={() => setAttempt((n) => n + 1)}
          >
            <Text style={styles.buttonLabel}>Try again</Text>
          </Pressable>
        </View>
      ) : web ? (
        <View id={containerId} style={{ flex: 1 }} />
      ) : (
        <>
          <Pressable
            style={{ flex: 1 }}
            accessibilityRole="imagebutton"
            accessibilityLabel={`${file.name}. Tap a spot to comment on it.`}
            onLayout={(event: LayoutChangeEvent) => setFrame(event.nativeEvent.layout)}
            onPress={onTap}
          >
            {picture ? (
              <Image source={{ uri: picture.uri }} style={{ flex: 1 }} resizeMode="contain" />
            ) : (
              <Text style={styles.empty}>Drawing the design</Text>
            )}
          </Pressable>
          <ScrollView style={{ maxHeight: 200 }}>
            {threads.length === 0 ? <Text style={styles.empty}>No open comments</Text> : null}
            {threads.map((thread) => (
              <View key={thread.id} style={styles.row}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowTitle}>{thread.author}</Text>
                  <Text style={styles.detailMuted}>{thread.preview}</Text>
                </View>
                <Pressable
                  style={styles.button}
                  accessibilityRole="button"
                  accessibilityLabel={`Send ${thread.author}'s comment to an agent`}
                  onPress={() => setSending(thread.preview)}
                >
                  <Text style={styles.buttonLabel}>Send to agent</Text>
                </Pressable>
              </View>
            ))}
          </ScrollView>
        </>
      )}
      <Modal visible={draft !== null} onRequestClose={() => setDraft(null)} title="Add comment">
        <TextInput
          style={styles.input}
          value={comment}
          onChangeText={setComment}
          placeholder="Comment"
          multiline
          autoFocus
          maxLength={2000}
        />
        <Pressable
          style={styles.button}
          accessibilityRole="button"
          onPress={() => void submitComment()}
        >
          <Text style={styles.buttonLabel}>Comment</Text>
        </Pressable>
      </Modal>
      <SendSheet
        visible={sending !== null}
        onClose={() => setSending(null)}
        workspaceId={workspaceId}
        file={file}
        theme={theme}
      />
    </View>
  );
}
```

The `attempt` field rides in the subscription input only to restart the view after a failure.

- [ ] **Step 6: Run the tap test, typecheck, lint. Harness check**

Use the stack harness from the office work (`/workspace/utils/paseo/.superpowers/sdd/2026-11-11-agent-office/stack/`): start the dev daemon on 6768 with `FIGCRAFT_URL` pointing at a local `figcraft-server` (from Task 1's install, `listen = "127.0.0.1:47900"`), `FIGCRAFT_SERVER_KEY` from `figcraft-server key`, `FIGCRAFT_CLI` set to the installed CLI, and a static server for the web build (`python3 -m http.server --directory <figcraft-web-0.18.1> 47910`, `FIGCRAFT_WEB_URL=http://127.0.0.1:47910/`). Take phone (390 x 844, touch) pictures of: empty list, list with one file, the native picture view with one thread (open the panel with a native user agent the harness supports, or check the native path in the component test below), the comment sheet, the Send sheet; then 820 and 1440 with the iframe editor. Check page errors are 0. Stop the dev daemon; nothing may listen on 6768.

A component test for the native picture path: `plugins/design/client/editor-view.test.tsx` rendering `EditorView` with `layout.platform: "android"` under the plugin test host the office uses (`plugins/office/client/scene/stream-view.mounted.test.tsx` shows how), pushing a `picture` event and a `threads` event, and asserting the `Image` source and the thread row; then a press at the picture's centre opens "Add comment" and Comment calls `addCommentRpc` with `{ x: 0.5, y: 0.5 }`.

- [ ] **Step 7: Commit** `feat(fork): design editor tab, phone picture with comments, and Send to agent`.

---

### Task 14: The `figcraft` stack: image, Caddy, compose and CI publish

**Files:**

- Create: `docker/figcraft/Dockerfile`, `docker/figcraft/Caddyfile`, `docker/figcraft/server.toml`, `docker/figcraft/entrypoint.sh`, `docker/docker-compose.figcraft.yml`
- Modify: `.github/workflows/docker.yml` (a `publish-figcraft` job like `publish-browser`)
- Modify: `docs/docker.md` (a "FigCraft (design mode)" section)

- [ ] **Step 1: `server.toml`**

```toml
# figcraft-server settings for the Paseo design stack. Values a deploy changes come from the
# environment through entrypoint.sh (public_url, web_url).
listen = "127.0.0.1:47900"
data = "/data"
trusted_proxy = "127.0.0.1"
```

- [ ] **Step 2: `Caddyfile`** (FigCraft's own browser-and-server block, on port 8080 behind Dokploy's Traefik, which does TLS)

```
{
	auto_https off
	admin off
}

:8080 {
	encode gzip
	redir /app /app/?{query} 308

	@entry path /app/ /app/index.html
	header @entry Cache-Control "no-cache"

	@release_assets path /app/figcraft-web-*.js /app/figcraft-web-*_bg.wasm
	header @release_assets Cache-Control "public, max-age=31536000, immutable" {
		defer
	}

	handle /favicon.ico {
		respond 204
	}

	handle_path /app/* {
		root * /srv/figcraft-web
		file_server
	}

	handle {
		reverse_proxy 127.0.0.1:47900
	}
}
```

- [ ] **Step 3: `entrypoint.sh`**

```sh
#!/bin/sh
# Starts figcraft-server and Caddy in one container. FIGCRAFT_PUBLIC_URL (wss://host/) and
# FIGCRAFT_WEB_URL (https://host/app/) name this deploy; the server key lives in /data and is read
# with `docker exec <container> figcraft-server --config /etc/figcraft/server.toml key`.
set -eu
: "${FIGCRAFT_PUBLIC_URL:?set FIGCRAFT_PUBLIC_URL, e.g. wss://figcraft.dev.mtapp.dev/}"
: "${FIGCRAFT_WEB_URL:?set FIGCRAFT_WEB_URL, e.g. https://figcraft.dev.mtapp.dev/app/}"
cp /etc/figcraft/server.toml /tmp/server.toml
printf 'public_url = "%s"\nweb_url = "%s"\n' "$FIGCRAFT_PUBLIC_URL" "$FIGCRAFT_WEB_URL" >> /tmp/server.toml
sed -i "s#<meta charset=\"utf-8\">#<meta charset=\"utf-8\"><meta name=\"figcraft-server\" content=\"${FIGCRAFT_PUBLIC_URL}\">#" /srv/figcraft-web/index.html
figcraft-server --config /tmp/server.toml &
server=$!
caddy run --config /etc/caddy/Caddyfile --adapter caddyfile &
proxy=$!
trap 'kill -TERM "$server" "$proxy" 2>/dev/null' TERM INT
wait -n "$server" "$proxy" 2>/dev/null || wait "$server"
kill -TERM "$server" "$proxy" 2>/dev/null || true
wait
```

(`wait -n` needs bash or a shell that has it; the image uses `bash` from Debian, so set the first line to `#!/bin/bash` and keep the rest.)

- [ ] **Step 4: `Dockerfile`**

```dockerfile
# The FigCraft design stack: figcraft-server and the figcraft-web build behind Caddy, pinned and
# checked against the release's SHA256SUMS.txt. Built by .github/workflows/docker.yml.
FROM debian:bookworm-slim
ARG FIGCRAFT_VERSION=0.18.1
ARG TARGETARCH
ARG IMAGE_SOURCE=https://github.com/allrested/paseo
LABEL org.opencontainers.image.source=${IMAGE_SOURCE}
RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends ca-certificates curl unzip caddy; \
    rm -rf /var/lib/apt/lists/*; \
    case "$TARGETARCH" in amd64) arch=x86_64 ;; arm64) arch=aarch64 ;; *) echo "unsupported $TARGETARCH" >&2; exit 1 ;; esac; \
    base="https://github.com/storytold/figcraft/releases/download/v${FIGCRAFT_VERSION}"; \
    server="figcraft-server-${FIGCRAFT_VERSION}-linux-${arch}.tar.gz"; \
    web="figcraft-web-${FIGCRAFT_VERSION}.zip"; \
    cd /tmp; \
    curl -fsSL -o SHA256SUMS.txt "$base/SHA256SUMS.txt"; \
    curl -fsSL -o "$server" "$base/$server"; \
    curl -fsSL -o "$web" "$base/$web"; \
    grep -E " (${server}|${web})\$" SHA256SUMS.txt | sha256sum -c -; \
    tar xzf "$server"; \
    install -m 0755 "$(find /tmp -name figcraft-server -type f | head -1)" /usr/local/bin/figcraft-server; \
    unzip -q "$web"; \
    mkdir -p /srv; \
    mv "/tmp/figcraft-web-${FIGCRAFT_VERSION}" /srv/figcraft-web; \
    rm -rf /tmp/*; \
    useradd --system --uid 10001 --home /data figcraft; \
    mkdir -p /data; chown figcraft /data /srv/figcraft-web /srv/figcraft-web/index.html
COPY figcraft/server.toml /etc/figcraft/server.toml
COPY figcraft/Caddyfile /etc/caddy/Caddyfile
COPY figcraft/entrypoint.sh /usr/local/bin/figcraft-entrypoint
RUN chmod 0755 /usr/local/bin/figcraft-entrypoint
USER figcraft
VOLUME /data
EXPOSE 8080
STOPSIGNAL SIGTERM
ENTRYPOINT ["/usr/local/bin/figcraft-entrypoint"]
```

If Debian bookworm's apt has no `caddy` package, replace `caddy` in the apt line with a copy from the official image: add `FROM caddy:2 AS caddy` at the top and `COPY --from=caddy /usr/bin/caddy /usr/local/bin/caddy` after the RUN.

- [ ] **Step 5: `docker-compose.figcraft.yml`**

```yaml
# The FigCraft design stack (design mode). One per host; every Paseo instance uses it.
# Dokploy: a Compose service from this file, domain figcraft.dev.mtapp.dev -> port 8080.
#   FIGCRAFT_PUBLIC_URL=wss://figcraft.dev.mtapp.dev/
#   FIGCRAFT_WEB_URL=https://figcraft.dev.mtapp.dev/app/
# The server key: docker exec figcraft figcraft-server --config /tmp/server.toml key
# Put it in each Paseo instance's FIGCRAFT_SERVER_KEY. Never in git.
services:
  figcraft:
    image: ${FIGCRAFT_IMAGE:-ghcr.io/allrested/paseo-figcraft:latest}
    pull_policy: always
    container_name: figcraft
    restart: unless-stopped
    mem_limit: ${FIGCRAFT_MEM_LIMIT:-512m}
    environment:
      FIGCRAFT_PUBLIC_URL: ${FIGCRAFT_PUBLIC_URL:-wss://figcraft.dev.mtapp.dev/}
      FIGCRAFT_WEB_URL: ${FIGCRAFT_WEB_URL:-https://figcraft.dev.mtapp.dev/app/}
    volumes:
      - figcraft-data:/data
    expose:
      - "8080"
    networks:
      - dokploy-network
volumes:
  figcraft-data:
networks:
  dokploy-network:
    external: true
```

- [ ] **Step 6: CI job** in `.github/workflows/docker.yml`, after `publish-browser`, the same shape with these differences: job `publish-figcraft`, `context: docker`, `file: docker/figcraft/Dockerfile`, `build-args: IMAGE_SOURCE=${{ github.server_url }}/${{ github.repository }}`, tags from a new `figcraft_publish_tags` output of the `setup` job built the way `browser_publish_tags` is (`ghcr.io/allrested/paseo-figcraft:<version>` and `:latest` when `publish_latest`), `cache-from/to` scope `paseo-figcraft`. Read the `setup` job's step that writes `browser_publish_tags` and add the same lines for figcraft. The `deploy` job does not redeploy the figcraft compose (it changes only with a FigCraft upgrade).

- [ ] **Step 7: Check the workflow and the image**

Run: `cd /workspace/utils/paseo && npx --yes @action-validator/cli .github/workflows/docker.yml` if available, else `node -e "require('yaml').parse(require('fs').readFileSync('.github/workflows/docker.yml','utf8'))"` (the repo has `yaml` in node_modules: `ls node_modules/yaml`). Expected: no error.
The image itself is first built by CI on the release tag (no Docker here). Before that, check the shell and Caddyfile: `bash -n docker/figcraft/entrypoint.sh` → no output; run Caddy's validator through the downloaded binary when one is at hand, otherwise note "Caddyfile not validated locally" in the task report.

- [ ] **Step 8: `docs/docker.md`**: a "FigCraft (design mode)" section: what the stack is, the two env vars, how to read the server key, that it goes into each Paseo instance's `FIGCRAFT_SERVER_KEY`, the domain, that a file removed in Paseo stays on the server until `docker exec figcraft figcraft-server --config /tmp/server.toml files remove <id>`, and that FigCraft is alpha and pinned (upgrade = change `FIGCRAFT_VERSION` in the Dockerfile, `install-figcraft.sh` and `docker/Dockerfile.agents`, then run the real contract test).

- [ ] **Step 9: Commit** `feat(fork): the FigCraft design stack image, compose and CI publish`.

---

### Task 15: `figcraft-cli` in the agents image, FigCraft env in the Paseo composes

**Files:**

- Modify: `docker/Dockerfile.agents`, `docker/docker-compose.yml`, `docker/docker-compose.vpn.yml`, `docker/.env.example` (if it exists; `ls docker/.env.example .env.example`)

- [ ] **Step 1: Install the pinned CLI** in `docker/Dockerfile.agents`, after the Kiro block (it already has `TARGETARCH`):

```dockerfile
# FigCraft CLI for design mode (plugins/design): the bridge and agents run `figcraft-cli mcp`.
# Pinned and checked against the release's SHA256SUMS.txt; keep in step with docker/figcraft.
ARG FIGCRAFT_VERSION=0.18.1
RUN set -eux; \
    case "$TARGETARCH" in amd64) arch=x86_64 ;; arm64) arch=aarch64 ;; *) echo "unsupported TARGETARCH: $TARGETARCH" >&2; exit 1 ;; esac; \
    base="https://github.com/storytold/figcraft/releases/download/v${FIGCRAFT_VERSION}"; \
    app="figcraft-${FIGCRAFT_VERSION}-linux-${arch}.tar.gz"; \
    cd /tmp; \
    curl -fsSL -o SHA256SUMS.txt "$base/SHA256SUMS.txt"; \
    curl -fsSL -o "$app" "$base/$app"; \
    grep " ${app}\$" SHA256SUMS.txt | sha256sum -c -; \
    tar xzf "$app"; \
    install -m 0755 "/tmp/figcraft-${FIGCRAFT_VERSION}-linux-${arch}/bin/figcraft-cli" /usr/local/bin/figcraft-cli; \
    rm -rf /tmp/figcraft-* /tmp/SHA256SUMS.txt; \
    figcraft-cli --version
```

If the step runs as a non-root `USER` at that point of the file, put it before the `USER` line (read the file around the Kiro block first).

- [ ] **Step 2: Env in both Paseo composes**, in the `paseo` service's `environment:` next to the other optional keys:

```yaml
# Design mode (plugins/design): our FigCraft server. Without both, design mode is off.
FIGCRAFT_URL: ${FIGCRAFT_URL:-}
FIGCRAFT_WEB_URL: ${FIGCRAFT_WEB_URL:-}
FIGCRAFT_SERVER_KEY: ${FIGCRAFT_SERVER_KEY:-}
```

Same three lines in `docker/docker-compose.vpn.yml`'s Paseo service. In `.env.example`, add the three keys with empty values and a one-line comment.

- [ ] **Step 3: Check** `node -e` YAML parse of both composes (as in Task 14 Step 7). `bash -n` is not applicable; read the Dockerfile diff once more for the `USER` placement.

- [ ] **Step 4: Commit** `feat(fork): figcraft-cli in the agents image and FigCraft env for the Paseo composes`.

---

### Task 16: The real FigCraft test in CI, docs, and the manual test

**Files:**

- Modify: `.github/workflows/fork-ci.yml` (a `figcraft-contract` job)
- Modify: `docs/plugins.md` (a design mode section)

- [ ] **Step 1: CI job** in `fork-ci.yml`, next to the other test jobs, same checkout and Node setup steps as `server-tests` (copy them), then:

```yaml
- name: Install FigCraft (pinned)
  id: figcraft
  run: bash plugins/design/test/install-figcraft.sh "$RUNNER_TEMP/figcraft" >> "$GITHUB_OUTPUT"
- name: Real FigCraft contract
  env:
    FIGCRAFT_CLI: ${{ steps.figcraft.outputs.FIGCRAFT_CLI }}
    FIGCRAFT_SERVER_BIN: ${{ steps.figcraft.outputs.FIGCRAFT_SERVER_BIN }}
  run: npx vitest run plugins/design/test/figcraft-contract.real.test.ts --bail=1
```

(`install-figcraft.sh` prints `KEY=value` lines, which is the `GITHUB_OUTPUT` format.) Then also run the design unit tests in that job: `npx vitest run plugins/design --no-file-parallelism --maxWorkers=1`.

- [ ] **Step 2: `docs/plugins.md`**: a "Design (built-in)" paragraph in the built-ins part, integrated where the office paragraph is, in the doc's voice: what it does, `FIGCRAFT_URL` / `FIGCRAFT_WEB_URL` / `FIGCRAFT_SERVER_KEY`, `design/tokens.json` (W3C, one collection `Tokens`, one mode, composite types kept out, repo wins on open, edits written back uncommitted), the `design_join` tool and the `figcraft` MCP server agents get (guarded: no sharing, publishing or hosting, joins only to our server), phone = picture and comments, at most 3 open designs, Remove forgets the file in Paseo only, link to the spec. Format with `npm run format:files -- docs/plugins.md docs/docker.md`.

- [ ] **Step 3: Full checks**

- `cd plugins && flock -w 480 /tmp/paseo-heavy.lock npx tsgo -p tsconfig.json --noEmit --singleThreaded` → exit 0
- `npm run lint -- plugins/design` → 0 errors
- `npm run format:files -- plugins/design docker .github docs` → no change after the run
- `flock -w 480 /tmp/paseo-heavy.lock npx vitest run plugins/design --no-file-parallelism --maxWorkers=1` → all pass, the real test skipped
- The real test again with the local binaries (Task 1 Step 4 command without `FIGCRAFT_RECORD`) → 5 pass
- `flock -w 480 /tmp/paseo-heavy.lock npx vitest run packages/server/src/server/plugins/builtin/index.test.ts -t "listed built-ins resolve to matching manifests" --bail=1` → pass

- [ ] **Step 4: Commit** `ci(fork): run the real FigCraft contract test; docs for design mode`.

- [ ] **Step 5: Manual test (needs the owner's yes before any agent turn)**

On the dev daemon (port 6768, `PASEO_HOME=$PWD/.dev/paseo-home`, started with `stack/daemon-start.sh` as `CLAUDE_CONFIG_DIR=/tmp/<dir> ./daemon-start.sh`) with the local FigCraft server and web build from Task 13 Step 6, and a sample workspace whose repo has a `design/tokens.json` (create one in a temp git repo with a colour, a spacing and a font token):

1. Designs panel lists nothing; New design "Card" appears as Closed; opening it on desktop shows the FigCraft editor joined to the file, the tokens loaded as variables.
2. With the owner's yes: one agent in the workspace is asked to "design a profile card with our tokens"; it calls `design_join` and draws; the desktop editor shows the edits live; the phone view's picture refreshes.
3. A comment added on the phone view reaches the agent as one prompt; the agent replies and resolves it.
4. On desktop, select the card, Send to agent "build this as a React component": the agent gets the note, the code export and a picture, and writes code in the repo.
5. Change a colour variable in FigCraft: within 10 s `git status` in the sample repo shows `design/tokens.json` modified, and the editor shows the "written to design/tokens.json" banner.
6. Close everything: 5 minutes later no `figcraft-cli` process runs for the dev daemon (`ps -eo pid,args | awk '/figcraft-cli/ && !/awk/'`).
7. Stop the dev daemon; nothing listens on 6768, 47900 or 47910.

Write the results to `.superpowers/sdd/2026-11-13-design-mode/manual-test.md` with the pictures under `.superpowers/screenshots/design-mode/`.

---

## Release and deploy (owner's yes for each)

1. Push `feat/design-mode` and merge to `main` (or cherry-pick onto it) when the owner says so.
2. Cut the next fork beta tag with the usual release flow (`docs` memory: release branch, `npm run version:all:beta:next`, push the tag alone). The tag publishes `paseo-figcraft` with the other images.
3. In the Oracle VM's Dokploy: a new Compose service from `docker/docker-compose.figcraft.yml`, domain `figcraft.dev.mtapp.dev` to port 8080, the two env vars. Deploy it, read the server key with `docker exec`, and put `FIGCRAFT_URL`, `FIGCRAFT_WEB_URL`, `FIGCRAFT_SERVER_KEY` into both Paseo composes' env in Dokploy. Redeploy both instances.
4. Check: `https://figcraft.dev.mtapp.dev/app/` loads the editor; the Designs panel on each instance lists nothing and can create a file.
