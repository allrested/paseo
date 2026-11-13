# Design plugin tests

Unit tests run against `fake-figcraft.mjs`, which answers like `figcraft-cli mcp` from the
fixtures in `fixtures/`. The fixtures come from the real FigCraft, through
`figcraft-contract.real.test.ts`.

## The real FigCraft test

```sh
bash plugins/design/test/install-figcraft.sh /tmp/figcraft   # prints FIGCRAFT_CLI=… and FIGCRAFT_SERVER_BIN=…
FIGCRAFT_CLI=… FIGCRAFT_SERVER_BIN=… npx vitest run plugins/design/test/figcraft-contract.real.test.ts --bail=1
```

Without the two variables the suite is skipped. `FIGCRAFT_RECORD=1` rewrites `fixtures/`;
keys, tokens and join codes are replaced by `<redacted>` on the way. Check with
`grep -rn "key=[^<]\|token=[^<]" plugins/design/test/fixtures` (no output) before a commit.

The installer checks every download against the release's `SHA256SUMS.txt`. Upgrading FigCraft:
change `FIGCRAFT_VERSION` here, in `docker/figcraft/Dockerfile` and in `docker/Dockerfile.agents`,
rerun this test with `FIGCRAFT_RECORD=1`, and read the fixture diff.

## Measured differences from the docs (v0.18.1, 2026-11-13)

- `collab.publish` returns at once with `status: "connecting"` and no links. Poll `collab.peers`:
  once `status` is `"live"`, the edit link is `link` and `published.edit`, the view link
  `published.view`. `share` stays `null` for a published file and `published.owner` is `null`.
- Links are `figcraft://join?host=<host[:port]>&file=<id>&token=<token>`, not `ws(s)://` URLs
  (`url` holds the WebSocket form). A guard that checks the server must read the `host` parameter.
- Layer ids are numbers and global across members (`4294967297`), in `create_node`, `select`,
  `presence.selection` and `inspect_document`. Comment ids are numbers too.
- Every member of a session is named "Guest N" unless `pref.userName {name}` ran before
  `collab.join` or `collab.publish`; then `collab.peers` shows that name. Agents' sessions are
  named "<name> (agent)" this way so the user's selection can be told apart.
- A joined file opens as a new document (`document: 1`), which becomes the active one.
- `variable.export {format: "json"}` returns `{text: "<the JSON>"}`; parse `text`. Its ids differ
  from the imported ones (`VariableCollectionId:1`, `VariableID:1`) and colours come back as
  32-bit floats (`0.800000011920929`); names and modes are kept.
- `comment.list` items have `resolved` (boolean), `text`, `author` and `agent`; there is no
  `status` or `preview` (`comment.prompt`'s items have `preview`). A comment made through MCP is
  `agent: true`, authored "<clientInfo.name> (agent)".
- `screenshot` answers with an `image` part (PNG, base64) and a `text` part holding
  `{width, height, ids, scale, source}`. An empty page answers with text only: "the current page
  is empty: nothing to render".
- `inspect_document {depth: 0}` gives no page bounds. `{depth: 1}` gives each top-level layer's
  `absoluteBounds`; the page picture covers their union.
- `codeConnect.export {}` returns `{links, text}` where `text` is `{"links": [], "version": 1}`
  for a file with no mappings.
