# What a stock daemon gives an installed plugin

Probed on 2026-11-18 with the published `@getpaseo/server@0.16.2` and `@getpaseo/cli@0.16.2`,
installed under `/tmp/paseo-stock`, on its own home and port 6798. The probe plugin is
`/tmp/office-probe`: `index.server.ts` logs what its process sees from `contribute`, and serves one
RPC that returns the keys of a handler's context. Plugin output below is from
`paseo plugin logs office-probe`, trimmed.

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
home:     "/home/paseo"
```

The subprocess inherits the daemon's whole environment. The first run (started from an agent's
shell) also showed `PASEO_AGENT_ID`, `PASEO_PASSWORD`, `PASEO_WORKSPACE_ID` and the rest of the
launching shell's `PASEO_*`. A plugin therefore sees the daemon's password if the daemon has one in
its environment. The later runs used `env -i` to keep the list to what the daemon itself passes.

## F3. Its own folder

None of the three gives the installed directory.

```
cwd:           "/tmp/paseo-stock"      (the daemon's cwd, not the plugin's)
argv:          ["/usr/local/bin/node", ".../server/dist/server/server/plugins/plugin-process.js"]
importMetaUrl: absent from the JSON line, so undefined
```

The daemon compiles the entry with esbuild into a CommonJS string and `eval`s it in
`plugin-process.js` (`bundle-evaluator.js`). `import.meta.url` is undefined there and `__dirname`
is not defined in that scope. The installed directory exists
(`<home>/plugins/<id>/<uuid>/checkout` for Git, the source path for a directory source) but the
process is not told. Files beside the plugin source have to be embedded in the bundle at build
time.

## F4. Dependencies

`zod` resolves in all four installs, because it is a host module: the daemon marks it external and
hands the plugin its own copy (`SERVER_HOST_MODULES` in `compiler-esbuild.js`, `runtimeRequire` in
`bundle-evaluator.js`). So do `@getpaseo/plugin` and its `/server` entries.

| Install                                   | `zod`    | Result                              |
| ----------------------------------------- | -------- | ----------------------------------- |
| Directory, `node_modules` installed       | resolves | running                             |
| Directory, no `node_modules`              | resolves | running                             |
| Git (`file://`), no `build`               | resolves | running                             |
| Git, `build: [["npm","ci","--omit=dev"]]` | resolves | running, `node_modules` in checkout |

`zod` is the wrong test for a plugin's own dependencies. Anything else is bundled by esbuild from
the plugin's directory at install time. Checked with a second plugin that imports `ms`:

```
paseo plugin install /tmp/office-probe2     (no node_modules)
Error: Build failed with 1 error:
../office-probe2/index.server.ts:1:15: ERROR: Could not resolve "ms"
```

The failed install leaves the plugin configured with status `failed`; after `npm install` in its
directory, `paseo plugin reload office-probe2` loaded it and it logged `ms(1000)=1s`. For a Git
source, a dependency other than `zod` and the SDK needs `build` to install it. A plugin with no
other dependency needs no `build`. With `build` and `@getpaseo/plugin` in `dependencies`, the
checkout gets about a dozen packages (`react`, `ws`, `i18next`, ...) that the bundle never reads.

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

`paseo plugin ls` lists the plugin for every install form:

```
office-probe   running   yes   git:file:///tmp/office-probe   34fee9fde23b...   <home>/plugins/office-probe/<uuid>/checkout
```

The web UI lists it too. Seen with the Paseo browser tools at `http://10.0.1.66:6798` on a
throwaway daemon bound to `0.0.0.0:6798` for the look, with no pairing and no credentials: the page
connected to its own daemon. Settings, Plugins shows `Installed · 1`, `office-probe`,
`git:file:///tmp/office-probe · 34fee9fde23b`. The tab is closed.

## F8. What was used

- Install: `npm install @getpaseo/server@0.16.2 @getpaseo/cli@0.16.2` in `/tmp/paseo-stock`.
- Entry point: `node node_modules/@getpaseo/server/dist/scripts/supervisor-entrypoint.js`, as the
  brief says. Environment: `PASEO_HOME=/tmp/paseo-stock/home`, `PASEO_LISTEN=127.0.0.1:6798`.
- Config: `home/config.json` with `{ "pluginsEnabled": true }`, as the brief says. The daemon adds a
  `plugins` map to it (`"office-probe": { "source": "directory", "path": ..., "enabled": true }`;
  a Git install is stored as a directory source on its checkout).
- The web UI is off by default on stock. It needed `PASEO_WEB_UI_ENABLED=true`.
- `paseo plugin remove <id>`, not `rm`. The brief's step 3.2 command is `plugin remove`.
- Git URL form: `paseo plugin install file:///tmp/office-probe`, after `git init -b main` and a
  commit. The source is recorded as `git:file:///tmp/office-probe` with the commit as revision.
- Calling the RPC needs a client. The CLI has no command for it. `/tmp/paseo-stock/scripts/call.mjs`
  uses `DaemonClient.invokePluginRpc` from `@getpaseo/client/dist/daemon-client.js` with `ws`.
- The daemon was restarted twice during the probe (kill the supervisor, start with the same
  command) to drop the inherited `PASEO_*` variables and to turn the web UI on. Plugin config
  survived. The pid file holds the supervisor's pid, not the shell's.
- `defineRpc` and `server.handle` have the shape the brief gives.

## What each finding selects

| Task | Finding | Branch it selects                                                                                                                              |
| ---- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| 3    | F3      | The scene is embedded in the server bundle as a string. A file next to the source, `import.meta.url` or `directory` cannot find it.            |
| 3    | F4      | The generated world module is one more source file in the bundle; it needs no `build` and no extra dependency.                                 |
| 4    | F6      | No second argument for an installed plugin, so `inDaemon` is `builtin !== undefined`.                                                          |
| 4    | F1      | Parent is the daemon worker, which is the listener. `daemonPid` is `ppid`. A supervisor sits one step above and `readAncestors` covers it.     |
| 4    | F2      | `PASEO_HOME` reaches the subprocess. `boardsFile(process.env, homedir())` and its siblings need no change. No open item for part 2.            |
| 6    | F4      | The generated `package.json` keeps `@getpaseo/plugin` and `zod` only. The Git form needs no `build` unless the office adds another dependency. |
| 6    | F5, F6  | Typecheck against the SDK types: `paseo` only on a handler's context, `contribute` takes the server context alone.                             |
| 6    | F7      | `paseo plugin ls` and Settings, Plugins both list a Git-installed plugin.                                                                      |
