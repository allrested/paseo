# What a stock daemon gives an installed plugin

Probed on 2026-11-18 with the published `@getpaseo/server@0.16.2` and `@getpaseo/cli@0.16.2`,
installed under `/tmp/paseo-stock`, on a throwaway home and port 6798. Every `paseo` call and the
daemon ran with `PASEO_HOME` set on the same command line. Before the first plugin command,
`paseo daemon status` reported `listen: 127.0.0.1:6798` and the throwaway home, not 6767.

The first probe plugin is `/tmp/office-probe`: `index.server.ts` logs what its process sees from
`contribute`, and serves one RPC that returns the keys of a handler's context. F1 to F3 and F5 to F7
come from it, on the home `/tmp/paseo-stock/home`. F4 was run again on a home with no `node_modules`
above it (`/tmp/office-stock-home`), with small plugins named in that section. Plugin output below
is from `paseo plugin logs <id>`, trimmed.

## F1. The server's process

The plugin is a subprocess of the process that listens on the port. The process tree is
supervisor, then daemon worker, then plugin.

```
parentCommand: "Paseo Daemon"      ppid 185586   (plugin pid 185799)
daemon status: pid 185575 (Paseo Supervisor), workerPid 185586
listener on :6798 (socket inode lookup in /proc): pid 185586 "Paseo Daemon"
```

`ppid` is the daemon. The listener is zero steps up. The supervisor is one step above that.

## F2. Its environment

`PASEO_HOME` is set. So is `HOME`. The only other `PASEO*` variable on a clean start is
`PASEO_LISTEN`, and only when the daemon was started with it:

```
paseoEnv: {"PASEO_HOME":"/tmp/paseo-stock/home","PASEO_LISTEN":"0.0.0.0:6798"}
home:     "<user home>"
```

The subprocess inherits the daemon's whole environment. A first run, started from an agent's shell,
also showed that shell's `PASEO_AGENT_ID`, `PASEO_WORKSPACE_ID`, `PASEO_PASSWORD` and the rest of
its `PASEO_*`. A plugin therefore sees whatever the daemon's environment holds, a password
included. The later runs used `env -i` with only `PATH`, `HOME`, `PASEO_HOME` and `PASEO_LISTEN`
(plus `PASEO_WEB_UI_ENABLED` for F7).

## F3. Its own folder

None of the three gives the installed directory. Observed in the directory, Git and Git-with-`build`
installs alike:

```
cwd:           "/tmp/paseo-stock"      (the daemon's cwd, not the plugin's)
argv:          ["/usr/local/bin/node", ".../server/dist/server/server/plugins/plugin-process.js"]
importMetaUrl: absent from the JSON line, so undefined
```

The cause is from reading `bundle-evaluator.js`, not from a run: the daemon compiles the entry with
esbuild into a CommonJS string and `eval`s it in `plugin-process.js`. `import.meta.url` is undefined
there, and `__dirname` is not defined in that scope. The installed directory exists
(`<home>/plugins/<id>/<uuid>/checkout` for Git, the source path for a directory source) but the
process is not told. Files beside the plugin source have to be embedded in the bundle at build
time.

## F4. Dependencies

Re-run on `PASEO_HOME=/tmp/office-stock-home`, with no `node_modules` in any folder above it or the
plugins (the packages stay in `/tmp/paseo-stock`, so the first run's Git rows could have found
`zod` by Node's ancestor lookup). The daemon ran with `env -i`, so no shell variable reached a log.

| Install                          | Plugin imports | Result                                  |
| -------------------------------- | -------------- | --------------------------------------- |
| (a) Directory, no `node_modules` | `zod`          | resolves, running                       |
| (b) Git (`file://`), no `build`  | `zod`          | resolves, running                       |
| (c) Git (`file://`), no `build`  | `ms`           | `Could not resolve "ms"`, not installed |

```
(a) [probe-a] zod resolved, version={"major":4,"minor":6,"patch":7} parse={"n":1}
(b) [probe-b] zod resolved, version={"major":4,"minor":6,"patch":7} parse={"n":1}
(c) Error: Build failed with 1 error:
    .../plugins/probe-c/<uuid>/checkout/index.server.ts:1:15: ERROR: Could not resolve "ms"
```

So `zod` resolves with nothing installed beside the plugin, and another package does not. The cause
is from reading the source: `zod` and `@getpaseo/plugin` are host modules, external in the bundle
and handed over by the daemon (`SERVER_HOST_MODULES` in `compiler-esbuild.js`, `runtimeRequire` in
`bundle-evaluator.js`). Everything else is bundled by esbuild from the plugin's directory at install
time.

The host hands over `zod` 4.6.7 (`/tmp/paseo-stock/node_modules/zod/package.json`; the plugin
printed the same version). The probe plugin's range `^4.4.3` and the SDK's own `^4.4.3` accept it.

Rows from the first run, where `zod` resolved but the home sat under `node_modules`:

| Install                                   | `zod`    | Result                              |
| ----------------------------------------- | -------- | ----------------------------------- |
| Directory, `node_modules` installed       | resolves | running                             |
| Git, `build: [["npm","ci","--omit=dev"]]` | resolves | running, `node_modules` in checkout |

Neither says more than (a) and (b). With `build` and `@getpaseo/plugin` in `dependencies`, the
checkout gets about a dozen packages (`react`, `ws`, `i18next`, ...) that the bundle never reads.

A failed directory install leaves the plugin configured with status `failed`. After `npm install` in
its directory, `paseo plugin reload <id>` loaded it. A failed Git install is not left configured.
For a Git source, a dependency other than `zod` and the SDK needs `build` to install it.

### A second, large source file

A Git plugin with no `build` whose `index.server.ts` imports `./server/big.ts`, a generated module
exporting one string. The file is 2,367,919 bytes. The handler returns the string's length:

```
[probe-d] big module loaded, length=2365589
RPC probe-d.len.request -> {"length":2365589}
```

The relative import with its `.ts` extension compiled, and the string survived whole. Time to
install (clone, compile, start): 5.4 s for the 2.4 MB plugin, against 2.4 s for the one-file `zod`
plugin, on a cold-ish machine and one run each. The daemon logged no size warning. Its only
warnings were `ws_slow_request` for each `plugin.source.install.request` over about 700 ms
(4541 ms for the large one, 1348 to 1801 ms for the small ones), which any install gets.

## F5. The server context

```
serverKeys:  addHook, before, handle, on, registerProvider, registerSettings, registerUsageSource
contextKeys: ["paseo"]          (handler context, from invoking the RPC)
```

`paseo` is on the handler's context only. The server context has no `paseo`. The SDK type says the
same: `PluginHandlerContext { paseo: PaseoApi }`.

## F6. The second argument

No. `contribute(server, second)` got `second === undefined`: `secondArgument: "none"`, for a
directory source and for a Git source.

## F7. Listing

`paseo plugin ls` lists the plugin for the directory and Git installs:

```
office-probe   running   yes   git:file:///tmp/office-probe   34fee9fde23b...   <home>/plugins/office-probe/<uuid>/checkout
```

The web UI lists it too. Seen with the Paseo browser tools at `http://<first address of hostname -i>:6798`
on a throwaway daemon bound to `0.0.0.0:6798` for the look, with no pairing and no credentials: the
page connected to its own daemon. Settings, Plugins shows `Installed · 1`, `office-probe`,
`git:file:///tmp/office-probe · 34fee9fde23b`. The tab is closed.

## F8. What was used

- Install: `npm install @getpaseo/server@0.16.2 @getpaseo/cli@0.16.2` in `/tmp/paseo-stock`.
- Entry point: `node node_modules/@getpaseo/server/dist/scripts/supervisor-entrypoint.js`.
  Environment: `PASEO_HOME=<throwaway home>`, `PASEO_LISTEN=127.0.0.1:6798`.
- Config: `<home>/config.json` with `{ "pluginsEnabled": true }`. The daemon adds a `plugins` map
  to it (`"office-probe": { "source": "directory", "path": ..., "enabled": true }`; a Git install is
  stored as a directory source on its checkout).
- The web UI is off by default on stock. It needed `PASEO_WEB_UI_ENABLED=true`.
- Removing a plugin is `paseo plugin remove <id>`. There is no `rm`.
- Git URL form: `paseo plugin install file:///tmp/office-probe`, after `git init -b main` and a
  commit. The source is recorded as `git:file:///tmp/office-probe` with the commit as revision.
- Calling the RPC needs a client. The CLI has no command for it. `/tmp/paseo-stock/scripts/call.mjs`
  uses `DaemonClient.invokePluginRpc` from `@getpaseo/client/dist/daemon-client.js` with `ws`.
- The daemon was restarted during the probe (kill the supervisor, start with the same command) to
  drop inherited `PASEO_*` variables, to turn the web UI on and to move F4 to a clean home. Plugin
  config survived a restart. The pid file holds the supervisor's pid, not the shell's.
- `defineRpc` and `server.handle` work as `@getpaseo/plugin@0.16.2` types them.

## What each finding selects

| Task | Finding | Branch it selects                                                                                                                                                                                        |
| ---- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 3    | F3      | The scene is embedded in the server bundle as a string. A file next to the source, `import.meta.url` or `directory` cannot find it.                                                                      |
| 3    | F4      | The generated world module is one more source file in the bundle. A 2.4 MB one installed and returned whole from a Git source with no `build`; no extra dependency.                                      |
| 4    | F6      | No second argument for an installed plugin, so `inDaemon` is `builtin !== undefined`.                                                                                                                    |
| 4    | F1      | Parent is the daemon worker, which is the listener. `daemonPid` is `ppid`. A supervisor sits one step above; Task 4 confirms `readAncestors` (`plugins/office/server/machine/cleanup.ts`) walks past it. |
| 4    | F2      | `PASEO_HOME` reaches the subprocess. `boardsFile(process.env, homedir())` and its siblings need no change. No open item for part 2.                                                                      |
| 6    | F4      | The generated `package.json` keeps `@getpaseo/plugin` and `zod` (`^4.4.3`, host has 4.6.7) only. The Git form needs no `build` unless the office adds another dependency.                                |
| 6    | F5, F6  | Typecheck against the SDK types: `paseo` only on a handler's context, `contribute` takes the server context alone.                                                                                       |
| 6    | F7      | `paseo plugin ls` and Settings, Plugins both list a Git-installed plugin.                                                                                                                                |

## Proof

`bash plugins/office/scripts/check-stock.sh` copies the office out of the workspace (tests
excluded), installs `@getpaseo/plugin@0.16.2` and `zod`, and typechecks with `strict` under
`NodeNext`, with nothing of the fork on the path. Its last line:

```
the office typechecks against @getpaseo/plugin@0.16.2
```

The first run passed: Tasks 2 to 5 had left no type that only the fork has, so the script found
nothing to fix in `plugins/office`. The script copies with `tar`, not `rsync`, which this container
does not have.

The real office, as that copy, was installed once as a directory source
(`paseo plugin install /tmp/office-stock-check`) on a throwaway stock daemon, home
`/tmp/office-stock-home`, listening on `0.0.0.0:6798` with `PASEO_WEB_UI_ENABLED=true` for the look.
`daemon status` showed port 6798 and that home before any plugin command.

- The plugin loaded in a subprocess: `paseo plugin ls` showed `running`, and `paseo plugin logs
office` held only `Loading plugin` and `Plugin ready`. No error names a missing call.
- The daemon logged the office's methods: the `office.*.request` set and `settings.office.read`,
  `write` and `reset`. The office's client session connected (`plugin:office`) to serve them.
- The state subscription and the agent tools: the settings page shows "Agent tools" on and the
  floor shows the empty host ("No agents on this host yet"), which is what a subscription with no
  agents gives. The daemon's log holds nothing about the tools. No agent was started, so no tool
  call was made, and the tools' presence in an agent session was not seen.
- The schedules: with the default settings, no notes folder and no tracker, neither is set. Nothing
  about a schedule is in the plugin's log or the daemon's. A schedule that did run was not seen.
- The web UI, with the Paseo browser at the first address of `hostname -i`:
  - The office's screen: the 3D floor drew, and the column (Attention 1, Sessions, Activity, Chat)
    showed.
  - The gear beside the 3D / 2D / List switch opened Settings > Plugins > office, with "Wake agents",
    "Agent tools", the notes folder, the zone and the tracker fields. This is the bug that started
    the work, and it is gone on stock.
  - Settings > Plugins lists `office` with source `/tmp/office-stock-check`.
  - The page's stored host from the first probe had the old daemon's id, so Settings said "Plugin
    host is offline" until the page's local storage was cleared. That is the browser's stale
    entry, not the office.

Screenshots are in `/tmp/office-stock-look/`: `01-plugins-host-offline.png` (the stale host),
`02-office-3d-floor-and-column.png`, `03-gear-opens-office-settings.png`,
`04-settings-plugins-list.png`.

Not seen: the stand-up run and the incidents check running, an agent's `office_read`, `office_post`
and `office_update`, a stand-up writer, and the 2D and List views. This is a first look. Part 2
installs from the new repo by Git.
