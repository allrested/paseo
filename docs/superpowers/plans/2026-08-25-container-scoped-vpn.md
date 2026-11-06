# Container-scoped SSL-VPN Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let agents in the Docker stack reach a private network over an SSL-VPN that lives entirely inside one container, so the host's routing and DNS are never touched.

**Architecture:** A gateway container runs `openfortivpn` and masquerades onto `ppp0`. Two sidecars join the `paseo` and `browser` network namespaces and install routes for a curated CIDR list pointing at that gateway. Everything ships as a Compose overlay that adds services and modifies none, so the existing stack is unchanged when the overlay is not applied.

**Tech Stack:** Docker Compose, `debian:bookworm-slim`, `openfortivpn`, `pppd`, `iptables`, `iproute2`, Bash, Node's built-in test runner (`node:test`), GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-08-25-container-scoped-vpn-design.md`

## Global Constraints

- **No organisation-specific values in tracked files.** No hostname, address range, realm, username, or credential. Real values live only in `docker/.env` (gitignored) or the deploy platform's environment settings. `.env.example` carries placeholders.
- **`INTERNAL_CIDRS` validation rules, all three enforced:** inside RFC 1918 (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`), prefix length `/12` or longer, and no overlap with the container's own addresses. No override flag.
- **The overlay is purely additive.** `docker-compose.vpn.yml` must not contain a `paseo:` or `browser:` service key, a `dns:` key, or a `networks:` block. Applying it must not recreate an existing container.
- **No default route inside the gateway container.** Only the declared CIDRs go via `ppp0`.
- **Gateway container privileges:** `cap_add: [NET_ADMIN]`, `devices: ["/dev/ppp"]`, `sysctls: {net.ipv4.ip_forward: "1"}`. Never `privileged: true`.
- **Compose never builds.** Services reference `${VPN_IMAGE}`; no `build:` key. Images come from GHCR.
- **Contract tests use Node built-ins only.** They run in `ci.yml`'s `changes` job, which has no `npm ci` — `scripts/ci-workflow.test.mjs` asserts that job never installs dependencies. No `js-yaml`, no imports outside `node:*`. Parse YAML by line, following `scripts/ci-workflow.test.mjs`.
- **`docker.yml` must not contain `${{ always()`** and must not add `dorny/paths-filter`. Both are asserted by `scripts/ci-workflow.test.mjs`.
- **Formatting and linting go through npm scripts only.** `npm run format:files -- <paths>` and `npm run lint -- <paths>`. Never invoke `oxfmt` or `oxlint` directly — a repo rule in `CLAUDE.md`.
- **Run only the test file you changed.** Never `npm run test`. A repo rule in `CLAUDE.md`.
- **Doc voice** for `docs/docker.md` and `docker/README.md`: plain, short, second person, per the "Writing docs" and "Doc voice" sections of `CLAUDE.md`. State the rule, then the reason when it is not obvious. No "it's not X, it's Y", no clauses that only assert importance, none of "robust", "seamless", "powerful", "simply", "just".
- **Shell scripts** use `#!/usr/bin/env bash` and `set -euo pipefail`. Every script needs a test seam so it runs on a developer machine without a container: an env override that short-circuits before any `ip`, `iptables`, or `getent` call.

---

## File Structure

**Created:**

| File                                                        | Responsibility                                                                        |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `docker/vpn/rootfs/usr/local/bin/paseo-vpn-validate`        | Enforces the three curation rules. Pure logic, no side effects, no network calls.     |
| `docker/vpn/rootfs/usr/local/bin/paseo-vpn-config`          | Renders the `openfortivpn` config file from the environment.                          |
| `docker/vpn/rootfs/usr/local/bin/paseo-vpn-entrypoint`      | Orchestration: validate, render config, install NAT rules, run the client retry loop. |
| `docker/vpn/rootfs/etc/ppp/ip-up.d/10-internal-routes`      | Installs the declared CIDR routes via `ppp0` when the link comes up.                  |
| `docker/vpn/rootfs/usr/local/bin/paseo-vpn-healthcheck`     | Probes the private network through the tunnel.                                        |
| `docker/vpn/rootfs/usr/local/bin/paseo-vpn-route`           | Sidecar assert loop, plus `--check` for its healthcheck.                              |
| `docker/agents/rootfs/usr/local/bin/paseo-agents-ssh-setup` | Writes the SSH config snippet and extra known-hosts file from the environment.        |
| `docker/Dockerfile.vpn`                                     | The gateway image.                                                                    |
| `docker/docker-compose.vpn.yml`                             | The overlay.                                                                          |
| `scripts/vpn-overlay.test.mjs`                              | Contract tests for all of the above.                                                  |

**Modified:**

| File                                 | Change                                                            |
| ------------------------------------ | ----------------------------------------------------------------- |
| `.github/workflows/ci.yml:55`        | Add the new test file to the `Validate CI contracts` step.        |
| `.github/workflows/docker.yml`       | `vpn_publish_tags` output, `publish-vpn` job, PR-path build step. |
| `docker/Dockerfile.agents`           | Copy and invoke `paseo-agents-ssh-setup`.                         |
| `docker/.env.example`                | Placeholder section for the new variables.                        |
| `docker/README.md`, `docs/docker.md` | Document the optional overlay.                                    |

Splitting `paseo-vpn-validate` and `paseo-vpn-config` out of the entrypoint is the decomposition that makes this testable. Both are pure functions of the environment — one returns a verdict, one returns text — so they can be driven directly by tests. The entrypoint that wires them together needs a container and is verified on the server in Task 8.

---

### Task 1: Curation validator

The highest-value piece: the rule that stops a declared CIDR from capturing a network something already depends on.

**Files:**

- Create: `docker/vpn/rootfs/usr/local/bin/paseo-vpn-validate`
- Create: `scripts/vpn-overlay.test.mjs`
- Modify: `.github/workflows/ci.yml:55`

**Interfaces:**

- Consumes: nothing.
- Produces: `paseo-vpn-validate`, an executable script. Reads `INTERNAL_CIDRS` (comma-separated CIDRs) and `PASEO_VPN_LOCAL_ADDRS` (comma-separated `a.b.c.d/len`; when unset, derived from `ip -o -4 addr show`). Exit `0` on success with a one-line confirmation on stdout; exit `1` on the first violation with `paseo-vpn: <reason>` on stderr. Task 3 calls it. Task 5 does not.

- [ ] **Step 1: Write the failing test**

Create `scripts/vpn-overlay.test.mjs`:

```javascript
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = new URL("../", import.meta.url);
const validatePath = fileURLToPath(
  new URL("docker/vpn/rootfs/usr/local/bin/paseo-vpn-validate", repoRoot),
);

// The scripts run under bash on the CI runner and under Git Bash on Windows.
// PASEO_VPN_LOCAL_ADDRS short-circuits the `ip` call so no container is needed.
function runValidate(env) {
  try {
    const stdout = execFileSync("bash", [validatePath], {
      encoding: "utf8",
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { code: 0, stdout, stderr: "" };
  } catch (error) {
    return {
      code: error.status ?? 1,
      stdout: error.stdout ?? "",
      stderr: error.stderr ?? "",
    };
  }
}

const LOCAL = { PASEO_VPN_LOCAL_ADDRS: "172.18.0.5/16,127.0.0.1/8" };

test("validator accepts a curated private range", () => {
  const result = runValidate({ ...LOCAL, INTERNAL_CIDRS: "10.4.0.0/16" });
  assert.equal(result.code, 0, result.stderr);
});

test("validator accepts several ranges", () => {
  const result = runValidate({
    ...LOCAL,
    INTERNAL_CIDRS: "10.4.0.0/16,10.15.0.0/16,192.168.40.0/22",
  });
  assert.equal(result.code, 0, result.stderr);
});

test("validator rejects public address space", () => {
  const result = runValidate({ ...LOCAL, INTERNAL_CIDRS: "52.219.32.0/21" });
  assert.equal(result.code, 1);
  assert.match(result.stderr, /outside RFC 1918/);
});

test("validator rejects a prefix broader than /12", () => {
  const result = runValidate({ ...LOCAL, INTERNAL_CIDRS: "10.0.0.0/8" });
  assert.equal(result.code, 1);
  assert.match(result.stderr, /broader than \/12/);
});

test("validator rejects a range covering the container's own network", () => {
  const result = runValidate({ ...LOCAL, INTERNAL_CIDRS: "172.16.0.0/12" });
  assert.equal(result.code, 1);
  assert.match(result.stderr, /overlaps this container's own network/);
});

test("validator rejects a range not aligned to its prefix", () => {
  const result = runValidate({ ...LOCAL, INTERNAL_CIDRS: "10.4.0.1/16" });
  assert.equal(result.code, 1);
  assert.match(result.stderr, /not aligned/);
});

test("validator rejects malformed input", () => {
  for (const value of ["10.4.0.0", "10.4.0.0/33", "10.4.0.256/16", "banana"]) {
    const result = runValidate({ ...LOCAL, INTERNAL_CIDRS: value });
    assert.equal(result.code, 1, `expected rejection for ${value}`);
  }
});

test("validator requires INTERNAL_CIDRS", () => {
  const result = runValidate({ ...LOCAL, INTERNAL_CIDRS: "" });
  assert.equal(result.code, 1);
  assert.match(result.stderr, /INTERNAL_CIDRS is required/);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test scripts/vpn-overlay.test.mjs`

Expected: every test fails — bash cannot find `docker/vpn/rootfs/usr/local/bin/paseo-vpn-validate`.

- [ ] **Step 3: Write the validator**

Create `docker/vpn/rootfs/usr/local/bin/paseo-vpn-validate`:

```bash
#!/usr/bin/env bash
# Enforces the Route curation rules from
# docs/superpowers/specs/2026-08-25-container-scoped-vpn-design.md.
#
# The gateway offers far more routes than this stack should install, including
# public address space and a range inside Docker's own address pool. Declared
# ranges are checked here instead, and a violation stops the container rather
# than producing a private name that resolves while connections hang.
#
# PASEO_VPN_LOCAL_ADDRS overrides interface discovery so tests run without a
# container. It must be read before any `ip` call.
set -euo pipefail

RFC1918="10.0.0.0/8 172.16.0.0/12 192.168.0.0/16"
MIN_PREFIX=12

fail() {
  printf 'paseo-vpn: %s\n' "$1" >&2
  exit 1
}

# Octets are forced to base 10: `08` is a valid octet but an invalid octal
# literal, and bash arithmetic would otherwise abort on it.
to_int() {
  local IFS='.' o1 o2 o3 o4
  read -r o1 o2 o3 o4 <<<"$1"
  printf '%s' "$(((10#$o1 << 24) + (10#$o2 << 16) + (10#$o3 << 8) + 10#$o4))"
}

mask_of() {
  if [ "$1" -eq 0 ]; then
    printf '0'
  else
    printf '%s' "$(((0xFFFFFFFF << (32 - $1)) & 0xFFFFFFFF))"
  fi
}

# Sets CIDR_NET and CIDR_LEN. Callers that loop must copy both out first.
parse_cidr() {
  local cidr=$1 addr len octet
  case "$cidr" in
    */*)
      addr=${cidr%%/*}
      len=${cidr##*/}
      ;;
    *) fail "not a CIDR, missing /prefix: $cidr" ;;
  esac
  [[ $addr =~ ^[0-9]{1,3}(\.[0-9]{1,3}){3}$ ]] || fail "malformed address: $cidr"
  [[ $len =~ ^[0-9]{1,2}$ ]] || fail "malformed prefix length: $cidr"
  [ "$((10#$len))" -le 32 ] || fail "prefix length above 32: $cidr"
  local IFS='.'
  for octet in $addr; do
    [ "$((10#$octet))" -le 255 ] || fail "octet above 255: $cidr"
  done
  CIDR_NET=$(to_int "$addr")
  CIDR_LEN=$((10#$len))
}

overlaps() {
  local n1=$1 l1=$2 n2=$3 l2=$4 len mask
  len=$l1
  [ "$l2" -lt "$len" ] && len=$l2
  mask=$(mask_of "$len")
  [ "$((n1 & mask))" -eq "$((n2 & mask))" ]
}

contained_in() {
  local n=$1 l=$2 bn=$3 bl=$4 mask
  [ "$bl" -le "$l" ] || return 1
  mask=$(mask_of "$bl")
  [ "$((n & mask))" -eq "$bn" ]
}

[ -n "${INTERNAL_CIDRS:-}" ] || fail "INTERNAL_CIDRS is required"

if [ -n "${PASEO_VPN_LOCAL_ADDRS:-}" ]; then
  local_addrs=${PASEO_VPN_LOCAL_ADDRS//,/ }
else
  local_addrs=$(ip -o -4 addr show | awk '{ print $4 }' | tr '\n' ' ')
fi

read -r -a entries <<<"${INTERNAL_CIDRS//,/ }"
for entry in "${entries[@]}"; do
  parse_cidr "$entry"
  net=$CIDR_NET
  len=$CIDR_LEN
  mask=$(mask_of "$len")

  [ "$((net & mask))" -eq "$net" ] || fail "$entry is not aligned to its prefix"
  [ "$len" -ge "$MIN_PREFIX" ] ||
    fail "$entry is broader than /$MIN_PREFIX; see Route curation in the spec"

  inside_rfc1918=0
  for block in $RFC1918; do
    parse_cidr "$block"
    if contained_in "$net" "$len" "$CIDR_NET" "$CIDR_LEN"; then
      inside_rfc1918=1
      break
    fi
  done
  [ "$inside_rfc1918" -eq 1 ] || fail "$entry is outside RFC 1918"

  for local_addr in $local_addrs; do
    parse_cidr "$local_addr"
    if overlaps "$net" "$len" "$CIDR_NET" "$CIDR_LEN"; then
      fail "$entry overlaps this container's own network $local_addr"
    fi
  done
done

printf 'paseo-vpn: validated %s\n' "$INTERNAL_CIDRS"
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test scripts/vpn-overlay.test.mjs`

Expected: PASS, 8 tests.

- [ ] **Step 5: Register the test in CI**

In `.github/workflows/ci.yml`, extend the `Validate CI contracts` step at line 55 so it reads:

```yaml
- name: Validate CI contracts
  run: node --test scripts/ci-workflow.test.mjs scripts/daemon-launch-contract.test.mjs scripts/vpn-overlay.test.mjs
```

Do not add an install step to this job — `scripts/ci-workflow.test.mjs` asserts the `changes` job contains no `Install dependencies` or `npm run build`.

- [ ] **Step 6: Verify the existing contract tests still pass**

Run: `node --test scripts/ci-workflow.test.mjs scripts/vpn-overlay.test.mjs`

Expected: PASS for both files.

- [ ] **Step 7: Format and commit**

```bash
npm run format:files -- scripts/vpn-overlay.test.mjs .github/workflows/ci.yml
npm run lint -- scripts/vpn-overlay.test.mjs
git add docker/vpn/rootfs/usr/local/bin/paseo-vpn-validate scripts/vpn-overlay.test.mjs .github/workflows/ci.yml
git commit -m "feat(docker): validate declared VPN CIDRs against curation rules"
```

---

### Task 2: Route sidecar script

**Files:**

- Create: `docker/vpn/rootfs/usr/local/bin/paseo-vpn-route`
- Modify: `scripts/vpn-overlay.test.mjs`

**Interfaces:**

- Consumes: nothing from Task 1 at runtime.
- Produces: `paseo-vpn-route`, an executable script. Reads `INTERNAL_CIDRS`, `VPN_GATEWAY_CONTAINER` (container name to resolve), `PASEO_VPN_GATEWAY_ADDR` (skips resolution — the test seam), `PASEO_VPN_DRY_RUN` (`1` prints commands instead of running them, and exits after one pass), and `PASEO_VPN_ROUTE_INTERVAL` (seconds between passes, default `30`). Called with `--check` it verifies the routes exist and exits `0` or `1`. Task 5 references it in the sidecar `command` and `healthcheck`.

- [ ] **Step 1: Write the failing test**

Append to `scripts/vpn-overlay.test.mjs`:

```javascript
const routePath = fileURLToPath(
  new URL("docker/vpn/rootfs/usr/local/bin/paseo-vpn-route", repoRoot),
);

function runRoute(env, args = []) {
  try {
    const stdout = execFileSync("bash", [routePath, ...args], {
      encoding: "utf8",
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { code: 0, stdout, stderr: "" };
  } catch (error) {
    return {
      code: error.status ?? 1,
      stdout: error.stdout ?? "",
      stderr: error.stderr ?? "",
    };
  }
}

const DRY = {
  PASEO_VPN_DRY_RUN: "1",
  PASEO_VPN_GATEWAY_ADDR: "172.18.0.9",
};

test("route sidecar emits one replace per declared CIDR", () => {
  const result = runRoute({
    ...DRY,
    INTERNAL_CIDRS: "10.4.0.0/16,10.15.0.0/16",
  });
  assert.equal(result.code, 0, result.stderr);
  const lines = result.stdout.trim().split("\n");
  assert.deepEqual(lines, [
    "ip route replace 10.4.0.0/16 via 172.18.0.9",
    "ip route replace 10.15.0.0/16 via 172.18.0.9",
  ]);
});

test("route sidecar never emits a default route", () => {
  const result = runRoute({ ...DRY, INTERNAL_CIDRS: "10.4.0.0/16" });
  assert.doesNotMatch(result.stdout, /default/);
  assert.doesNotMatch(result.stdout, /0\.0\.0\.0\/0/);
});

test("route sidecar requires a resolvable gateway", () => {
  const result = runRoute({
    PASEO_VPN_DRY_RUN: "1",
    INTERNAL_CIDRS: "10.4.0.0/16",
    VPN_GATEWAY_CONTAINER: "",
  });
  assert.equal(result.code, 1);
  assert.match(result.stderr, /VPN_GATEWAY_CONTAINER is required/);
});

test("route sidecar --check reports the routes it would verify", () => {
  const result = runRoute({ ...DRY, INTERNAL_CIDRS: "10.4.0.0/16" }, ["--check"]);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /ip route show 10\.4\.0\.0\/16/);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test scripts/vpn-overlay.test.mjs`

Expected: the four new tests fail; the Task 1 tests still pass.

- [ ] **Step 3: Write the sidecar script**

Create `docker/vpn/rootfs/usr/local/bin/paseo-vpn-route`:

```bash
#!/usr/bin/env bash
# Installs routes for the declared CIDRs into the namespace this container
# shares with paseo or browser, pointing at the VPN gateway container.
#
# Runs as a loop rather than once. `ip route replace` is idempotent, so a pass
# that changes nothing costs nothing, and a gateway container that was recreated
# with a new address is picked up on the next pass without intervention.
#
# The gateway is addressed by CONTAINER name, not service name: on a shared
# proxy network every instance's service carries the same DNS alias, so a
# service name can resolve to another instance's container.
set -euo pipefail

interval=${PASEO_VPN_ROUTE_INTERVAL:-30}
dry_run=${PASEO_VPN_DRY_RUN:-}
check_only=

if [ "${1:-}" = "--check" ]; then
  check_only=1
fi

fail() {
  printf 'paseo-vpn-route: %s\n' "$1" >&2
  exit 1
}

[ -n "${INTERNAL_CIDRS:-}" ] || fail "INTERNAL_CIDRS is required"

resolve_gateway() {
  if [ -n "${PASEO_VPN_GATEWAY_ADDR:-}" ]; then
    printf '%s' "$PASEO_VPN_GATEWAY_ADDR"
    return 0
  fi
  [ -n "${VPN_GATEWAY_CONTAINER:-}" ] || fail "VPN_GATEWAY_CONTAINER is required"
  local addr
  addr=$(getent hosts "$VPN_GATEWAY_CONTAINER" | awk '{ print $1 }' | head -1)
  [ -n "$addr" ] || fail "cannot resolve $VPN_GATEWAY_CONTAINER"
  printf '%s' "$addr"
}

read -r -a cidrs <<<"${INTERNAL_CIDRS//,/ }"

if [ -n "$check_only" ]; then
  status=0
  for cidr in "${cidrs[@]}"; do
    if [ -n "$dry_run" ]; then
      printf 'ip route show %s\n' "$cidr"
      continue
    fi
    if [ -z "$(ip route show "$cidr")" ]; then
      printf 'paseo-vpn-route: %s missing from this namespace\n' "$cidr" >&2
      status=1
    fi
  done
  exit "$status"
fi

while true; do
  gateway=$(resolve_gateway)
  for cidr in "${cidrs[@]}"; do
    if [ -n "$dry_run" ]; then
      printf 'ip route replace %s via %s\n' "$cidr" "$gateway"
    else
      ip route replace "$cidr" via "$gateway"
    fi
  done
  [ -n "$dry_run" ] && exit 0
  sleep "$interval"
done
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test scripts/vpn-overlay.test.mjs`

Expected: PASS, 12 tests.

- [ ] **Step 5: Commit**

```bash
git add docker/vpn/rootfs/usr/local/bin/paseo-vpn-route scripts/vpn-overlay.test.mjs
git commit -m "feat(docker): add VPN route sidecar assert loop"
```

---

### Task 3: Gateway config renderer, entrypoint, route hook, healthcheck

**Files:**

- Create: `docker/vpn/rootfs/usr/local/bin/paseo-vpn-config`
- Create: `docker/vpn/rootfs/usr/local/bin/paseo-vpn-entrypoint`
- Create: `docker/vpn/rootfs/etc/ppp/ip-up.d/10-internal-routes`
- Create: `docker/vpn/rootfs/usr/local/bin/paseo-vpn-healthcheck`
- Modify: `scripts/vpn-overlay.test.mjs`

**Interfaces:**

- Consumes: `paseo-vpn-validate` from Task 1, invoked by the entrypoint.
- Produces:
  - `paseo-vpn-config` — prints the `openfortivpn` config to stdout. Reads `VPN_GATEWAY`, `VPN_PORT`, `VPN_USERNAME`, `VPN_PASSWORD`, `VPN_TRUSTED_CERT`, `VPN_REALM`. Exits `1` naming the first missing required variable.
  - `paseo-vpn-entrypoint` — the image `ENTRYPOINT`.
  - `paseo-vpn-healthcheck` — reads `VPN_HEALTH_TARGET` as `host:port`; falls back to asserting `ppp0` exists when unset. `PASEO_VPN_DRY_RUN=1` prints the intended probe.
  - `10-internal-routes` — invoked by `pppd`; reads `INTERNAL_CIDRS` and `PASEO_VPN_DRY_RUN`.

- [ ] **Step 1: Write the failing test**

Append to `scripts/vpn-overlay.test.mjs`:

```javascript
const configPath = fileURLToPath(
  new URL("docker/vpn/rootfs/usr/local/bin/paseo-vpn-config", repoRoot),
);
const healthPath = fileURLToPath(
  new URL("docker/vpn/rootfs/usr/local/bin/paseo-vpn-healthcheck", repoRoot),
);
const ipUpPath = fileURLToPath(
  new URL("docker/vpn/rootfs/etc/ppp/ip-up.d/10-internal-routes", repoRoot),
);

function runScript(scriptPath, env, args = []) {
  try {
    const stdout = execFileSync("bash", [scriptPath, ...args], {
      encoding: "utf8",
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { code: 0, stdout, stderr: "" };
  } catch (error) {
    return {
      code: error.status ?? 1,
      stdout: error.stdout ?? "",
      stderr: error.stderr ?? "",
    };
  }
}

const VPN_ENV = {
  VPN_GATEWAY: "vpn.example.com",
  VPN_PORT: "11443",
  VPN_USERNAME: "someone",
  VPN_PASSWORD: "secret",
  VPN_TRUSTED_CERT: "abc123",
};

test("config renderer emits the client config", () => {
  const result = runScript(configPath, VPN_ENV);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /^host = vpn\.example\.com$/m);
  assert.match(result.stdout, /^port = 11443$/m);
  assert.match(result.stdout, /^username = someone$/m);
  assert.match(result.stdout, /^password = secret$/m);
  assert.match(result.stdout, /^trusted-cert = abc123$/m);
});

test("config renderer omits an unset realm and unset trusted-cert", () => {
  const result = runScript(configPath, { ...VPN_ENV, VPN_TRUSTED_CERT: "" });
  assert.equal(result.code, 0, result.stderr);
  assert.doesNotMatch(result.stdout, /trusted-cert/);
  assert.doesNotMatch(result.stdout, /realm/);
});

test("config renderer includes a realm when one is set", () => {
  const result = runScript(configPath, { ...VPN_ENV, VPN_REALM: "contractors" });
  assert.match(result.stdout, /^realm = contractors$/m);
});

test("config renderer refuses to start without a password", () => {
  const result = runScript(configPath, { ...VPN_ENV, VPN_PASSWORD: "" });
  assert.equal(result.code, 1);
  assert.match(result.stderr, /VPN_PASSWORD is required/);
});

test("config renderer refuses to start without a gateway", () => {
  const result = runScript(configPath, { ...VPN_ENV, VPN_GATEWAY: "" });
  assert.equal(result.code, 1);
  assert.match(result.stderr, /VPN_GATEWAY is required/);
});

test("route hook adds only the declared CIDRs and no default route", () => {
  const result = runScript(ipUpPath, {
    PASEO_VPN_DRY_RUN: "1",
    INTERNAL_CIDRS: "10.4.0.0/16,10.15.0.0/16",
  });
  assert.equal(result.code, 0, result.stderr);
  const lines = result.stdout.trim().split("\n");
  assert.deepEqual(lines, [
    "ip route replace 10.4.0.0/16 dev ppp0",
    "ip route replace 10.15.0.0/16 dev ppp0",
  ]);
  assert.doesNotMatch(result.stdout, /default/);
});

test("healthcheck probes the configured target", () => {
  const result = runScript(healthPath, {
    PASEO_VPN_DRY_RUN: "1",
    VPN_HEALTH_TARGET: "git.example.com:22",
  });
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /nc -z -w 5 git\.example\.com 22/);
});

test("healthcheck falls back to asserting ppp0 exists", () => {
  const result = runScript(healthPath, {
    PASEO_VPN_DRY_RUN: "1",
    VPN_HEALTH_TARGET: "",
  });
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /ip -4 addr show ppp0/);
});

test("healthcheck rejects a malformed target", () => {
  const result = runScript(healthPath, {
    PASEO_VPN_DRY_RUN: "1",
    VPN_HEALTH_TARGET: "git.example.com",
  });
  assert.equal(result.code, 1);
  assert.match(result.stderr, /must be host:port/);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test scripts/vpn-overlay.test.mjs`

Expected: the nine new tests fail; the previous twelve pass.

- [ ] **Step 3: Write the config renderer**

Create `docker/vpn/rootfs/usr/local/bin/paseo-vpn-config`:

```bash
#!/usr/bin/env bash
# Renders the openfortivpn config to stdout.
#
# Separate from the entrypoint so it can be tested directly, and so the
# credential never reaches a command line: the entrypoint redirects this into a
# 0600 file, and `ps` inside the container shows no password.
set -euo pipefail

fail() {
  printf 'paseo-vpn: %s\n' "$1" >&2
  exit 1
}

require() {
  local name=$1
  [ -n "${!name:-}" ] || fail "$name is required"
}

require VPN_GATEWAY
require VPN_PORT
require VPN_USERNAME
require VPN_PASSWORD

printf 'host = %s\n' "$VPN_GATEWAY"
printf 'port = %s\n' "$VPN_PORT"
printf 'username = %s\n' "$VPN_USERNAME"
printf 'password = %s\n' "$VPN_PASSWORD"

# Absent on the very first connect: the client refuses the unknown certificate
# and prints the digest to pin here. Leaving it unset permanently gives up
# machine-in-the-middle protection.
if [ -n "${VPN_TRUSTED_CERT:-}" ]; then
  printf 'trusted-cert = %s\n' "$VPN_TRUSTED_CERT"
fi

# Realm-scoped portals reject an otherwise valid credential in a way that looks
# like a bad password, so this is set only when the portal actually uses one.
if [ -n "${VPN_REALM:-}" ]; then
  printf 'realm = %s\n' "$VPN_REALM"
fi
```

- [ ] **Step 4: Write the route hook**

Create `docker/vpn/rootfs/etc/ppp/ip-up.d/10-internal-routes`:

```bash
#!/usr/bin/env bash
# Run by pppd when the tunnel comes up. Installs exactly the declared CIDRs and
# no default route, so the container keeps its own path to the internet — which
# the client's TLS connection to the gateway depends on.
set -euo pipefail

[ -n "${INTERNAL_CIDRS:-}" ] || {
  printf 'paseo-vpn: INTERNAL_CIDRS is required\n' >&2
  exit 1
}

read -r -a cidrs <<<"${INTERNAL_CIDRS//,/ }"
for cidr in "${cidrs[@]}"; do
  if [ -n "${PASEO_VPN_DRY_RUN:-}" ]; then
    printf 'ip route replace %s dev ppp0\n' "$cidr"
  else
    ip route replace "$cidr" dev ppp0
  fi
done
```

- [ ] **Step 5: Write the healthcheck**

Create `docker/vpn/rootfs/usr/local/bin/paseo-vpn-healthcheck`:

```bash
#!/usr/bin/env bash
# Health means the private network answers through the tunnel. A ppp0 that
# exists while routing nowhere is not healthy, and reporting it as healthy hides
# the failure this stack most needs to see.
set -euo pipefail

target=${VPN_HEALTH_TARGET:-}

if [ -z "$target" ]; then
  if [ -n "${PASEO_VPN_DRY_RUN:-}" ]; then
    printf 'ip -4 addr show ppp0\n'
    exit 0
  fi
  ip -4 addr show ppp0 | grep -q 'inet '
  exit 0
fi

case "$target" in
  *:*) ;;
  *)
    printf 'paseo-vpn: VPN_HEALTH_TARGET must be host:port\n' >&2
    exit 1
    ;;
esac

host=${target%:*}
port=${target##*:}

if [ -n "${PASEO_VPN_DRY_RUN:-}" ]; then
  printf 'nc -z -w 5 %s %s\n' "$host" "$port"
  exit 0
fi

nc -z -w 5 "$host" "$port"
```

- [ ] **Step 6: Write the entrypoint**

Create `docker/vpn/rootfs/usr/local/bin/paseo-vpn-entrypoint`:

```bash
#!/usr/bin/env bash
# Gateway container entrypoint.
#
# Validates before connecting, then keeps the client alive. Nothing here touches
# the host: the tunnel, its routes, and these iptables rules exist only in this
# container's network namespace.
set -euo pipefail

log() { printf 'paseo-vpn: %s\n' "$1" >&2; }

/usr/local/bin/paseo-vpn-validate

if [ ! -c /dev/ppp ]; then
  log "/dev/ppp is missing. Load ppp_generic on the host (modprobe ppp_generic)"
  exit 1
fi

umask 077
/usr/local/bin/paseo-vpn-config > /etc/openfortivpn/config
chmod 600 /etc/openfortivpn/config

# Only traffic bound for the declared ranges may leave through the tunnel, so a
# route added by mistake in a sidecar cannot push unrelated traffic to the
# corporate network.
iptables -P FORWARD DROP
iptables -A FORWARD -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
read -r -a cidrs <<<"${INTERNAL_CIDRS//,/ }"
for cidr in "${cidrs[@]}"; do
  iptables -A FORWARD -o ppp0 -d "$cidr" -j ACCEPT
done
iptables -t nat -A POSTROUTING -o ppp0 -j MASQUERADE

# Route and DNS management are disabled: this is what discards the gateway's
# pushed route list, most of which is public address space. Routes come from
# /etc/ppp/ip-up.d/10-internal-routes instead.
#
# The flag spelling differs across releases. Pick whichever the packaged binary
# accepts rather than assuming.
if openfortivpn --help 2>&1 | grep -q -- '--set-routes'; then
  route_flags=(--set-routes=0 --set-dns=0)
else
  route_flags=(--no-routes --no-dns)
fi

backoff=5
while true; do
  log "connecting to ${VPN_GATEWAY}:${VPN_PORT}"
  if openfortivpn -c /etc/openfortivpn/config "${route_flags[@]}"; then
    backoff=5
  else
    log "client exited, retrying in ${backoff}s"
  fi
  sleep "$backoff"
  [ "$backoff" -lt 60 ] && backoff=$((backoff * 2))
done
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `node --test scripts/vpn-overlay.test.mjs`

Expected: PASS, 21 tests.

- [ ] **Step 8: Commit**

```bash
git add docker/vpn/rootfs scripts/vpn-overlay.test.mjs
git commit -m "feat(docker): add VPN gateway entrypoint, config renderer, and health probe"
```

---

### Task 4: Gateway image and publish job

**Files:**

- Create: `docker/Dockerfile.vpn`
- Modify: `.github/workflows/docker.yml`
- Modify: `scripts/vpn-overlay.test.mjs`

**Interfaces:**

- Consumes: every script from Tasks 1-3, copied from `docker/vpn/rootfs`.
- Produces: `ghcr.io/<owner>/paseo-vpn:<version>`, entrypoint `/usr/local/bin/paseo-vpn-entrypoint`. Task 5 references it through `${VPN_IMAGE}`.

- [ ] **Step 1: Write the failing test**

Append to `scripts/vpn-overlay.test.mjs`:

```javascript
import { readFileSync } from "node:fs";

const dockerWorkflow = readFileSync(
  fileURLToPath(new URL(".github/workflows/docker.yml", repoRoot)),
  "utf8",
);

// Mirrors jobBlocks() in scripts/ci-workflow.test.mjs: split top-level jobs by
// their two-space indented keys. Hand-parsed because this test runs in the
// `changes` job, which installs no dependencies.
function jobBlocks(source) {
  const jobs = new Map();
  let current;
  for (const line of source.split("\n")) {
    const match = /^ {2}([a-z0-9-]+):\s*$/.exec(line);
    if (match) {
      current = match[1];
      jobs.set(current, []);
      continue;
    }
    if (current) jobs.get(current).push(line);
  }
  return jobs;
}

test("docker workflow publishes the VPN gateway image", () => {
  const job = jobBlocks(dockerWorkflow).get("publish-vpn")?.join("\n");
  assert.ok(job, "publish-vpn job is missing");
  assert.match(job, /file: docker\/Dockerfile\.vpn/);
  assert.match(job, /tags: \$\{\{ needs\.setup\.outputs\.vpn_publish_tags \}\}/);
  assert.match(job, /push: true/);
  // FROM debian, not the paseo base, so it must not wait on the base publish.
  assert.match(job, /needs: \[setup\]/);
});

test("docker workflow build-checks the VPN image on pull requests", () => {
  const job = jobBlocks(dockerWorkflow).get("build")?.join("\n");
  assert.ok(job);
  assert.match(job, /file: docker\/Dockerfile\.vpn/);
});

test("setup job exposes vpn_publish_tags", () => {
  const job = jobBlocks(dockerWorkflow).get("setup")?.join("\n");
  assert.ok(job);
  assert.match(job, /vpn_publish_tags/);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test scripts/vpn-overlay.test.mjs`

Expected: the three new tests fail — no `publish-vpn` job exists.

- [ ] **Step 3: Write the Dockerfile**

Create `docker/Dockerfile.vpn`:

```dockerfile
# syntax=docker/dockerfile:1
# SSL-VPN gateway for the optional private-network overlay
# (docker/docker-compose.vpn.yml).
#
# bookworm to match the paseo base image, so the stack has one userland.
#
# Built here rather than pulled from a third party: this container holds live
# VPN credentials and a route into a private network, so an unreviewed image is
# the wrong trade.
FROM debian:bookworm-slim

RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends \
      openfortivpn \
      ppp \
      iptables \
      iproute2 \
      netcat-openbsd \
      ca-certificates; \
    rm -rf /var/lib/apt/lists/*; \
    mkdir -p /etc/openfortivpn

COPY vpn/rootfs/ /

# A Windows checkout with core.autocrlf=true rewrites these scripts to CRLF, so
# the `#!/usr/bin/env bash` shebang picks up a trailing carriage return and the
# container dies with exit 127. Strip them, then assert each script parses.
RUN set -eux; \
    for script in \
      /usr/local/bin/paseo-vpn-validate \
      /usr/local/bin/paseo-vpn-config \
      /usr/local/bin/paseo-vpn-entrypoint \
      /usr/local/bin/paseo-vpn-healthcheck \
      /usr/local/bin/paseo-vpn-route \
      /etc/ppp/ip-up.d/10-internal-routes; do \
      sed -i 's/\r$//' "$script"; \
      chmod +x "$script"; \
      bash -n "$script"; \
    done

ENTRYPOINT ["/usr/local/bin/paseo-vpn-entrypoint"]
```

- [ ] **Step 4: Add the `vpn_publish_tags` output**

In `.github/workflows/docker.yml`, add to the `setup` job's `outputs` block:

```yaml
vpn_publish_tags: ${{ steps.values.outputs.vpn_publish_tags }}
```

In the `values` step, beside the existing `agents_image` assignment:

```bash
          vpn_image="ghcr.io/${owner}/paseo-vpn"
```

beside the existing `agents_publish_tags` assignment:

```bash
          vpn_publish_tags="${vpn_image}:${install_version}"
```

inside the `publish_latest` branch, after the `agents_publish_tags` line:

```bash
            vpn_publish_tags="${vpn_publish_tags}"$'\n'"${vpn_image}:latest"
```

and in the `$GITHUB_OUTPUT` block:

```bash
            echo "vpn_publish_tags<<EOF"
            echo "${vpn_publish_tags}"
            echo "EOF"
```

The image carries the same version as the other two even though nothing in it tracks the paseo version, so one number pins the whole stack.

- [ ] **Step 5: Add the pull-request build check**

In the `build` job of `.github/workflows/docker.yml`, after the existing `docker/build-push-action` step, add:

```yaml
- uses: docker/build-push-action@v7
  with:
    context: docker
    file: docker/Dockerfile.vpn
    platforms: ${{ env.PLATFORMS }}
    push: false
    provenance: false
    cache-from: type=gha,scope=paseo-vpn
    cache-to: type=gha,scope=paseo-vpn,mode=max
```

The context is `docker` because `Dockerfile.vpn` copies only `vpn/rootfs/`.

- [ ] **Step 6: Add the publish job**

Append to `.github/workflows/docker.yml`:

```yaml
# The gateway image for the optional private-network overlay. FROM debian, not
# the paseo base, so it needs only `setup` and publishes in parallel with the
# base and agents images.
publish-vpn:
  needs: [setup]
  if: needs.setup.outputs.publish == 'true'
  runs-on: ubuntu-latest
  permissions:
    contents: read
    packages: write
  steps:
    - uses: actions/checkout@v6

    - uses: docker/setup-qemu-action@v4
    - uses: docker/setup-buildx-action@v4

    - name: Log in to GHCR
      uses: docker/login-action@v4
      with:
        registry: ${{ env.REGISTRY }}
        username: ${{ github.actor }}
        password: ${{ secrets.GITHUB_TOKEN }}

    - uses: docker/build-push-action@v7
      with:
        context: docker
        file: docker/Dockerfile.vpn
        platforms: ${{ env.PLATFORMS }}
        tags: ${{ needs.setup.outputs.vpn_publish_tags }}
        push: true
        provenance: false
        cache-from: type=gha,scope=paseo-vpn
        cache-to: type=gha,scope=paseo-vpn,mode=max
```

Do not add `${{ always() }}` anywhere — `scripts/ci-workflow.test.mjs` fails the build if `docker.yml` contains it.

- [ ] **Step 7: Run the tests to verify they pass**

Run: `node --test scripts/vpn-overlay.test.mjs scripts/ci-workflow.test.mjs`

Expected: PASS for both. The second file matters here: it holds the `always()` and paths-filter assertions on `docker.yml`.

- [ ] **Step 8: Commit**

```bash
npm run format:files -- .github/workflows/docker.yml scripts/vpn-overlay.test.mjs
git add docker/Dockerfile.vpn .github/workflows/docker.yml scripts/vpn-overlay.test.mjs
git commit -m "feat(docker): build and publish the VPN gateway image"
```

---

### Task 5: The Compose overlay

**Files:**

- Create: `docker/docker-compose.vpn.yml`
- Modify: `scripts/vpn-overlay.test.mjs`

**Interfaces:**

- Consumes: `${VPN_IMAGE}` from Task 4; `paseo-vpn-route` and `paseo-vpn-healthcheck` from Tasks 2-3.
- Produces: services `vpn`, `paseo-vpn-route`, `browser-vpn-route`.

- [ ] **Step 1: Write the failing test**

Append to `scripts/vpn-overlay.test.mjs`:

```javascript
const overlay = readFileSync(
  fileURLToPath(new URL("docker/docker-compose.vpn.yml", repoRoot)),
  "utf8",
);

// Compose services sit at two-space indent under `services:`, the same shape
// jobBlocks() handles for workflows.
function serviceBlocks(source) {
  const services = new Map();
  let current;
  let inServices = false;
  for (const line of source.split("\n")) {
    if (/^services:\s*$/.test(line)) {
      inServices = true;
      continue;
    }
    if (/^[a-z]/.test(line)) inServices = false;
    if (!inServices) continue;
    const match = /^ {2}([a-z0-9-]+):\s*$/.exec(line);
    if (match) {
      current = match[1];
      services.set(current, []);
      continue;
    }
    if (current) services.get(current).push(line);
  }
  return services;
}

test("overlay defines the gateway and both route sidecars", () => {
  const services = serviceBlocks(overlay);
  assert.deepEqual([...services.keys()].sort(), ["browser-vpn-route", "paseo-vpn-route", "vpn"]);
});

test("overlay modifies no existing service", () => {
  const services = serviceBlocks(overlay);
  assert.ok(!services.has("paseo"), "overlay must not modify the paseo service");
  assert.ok(!services.has("browser"), "overlay must not modify the browser service");
  assert.doesNotMatch(overlay, /^\s+dns:/m, "no DNS override: public DNS already resolves");
  assert.doesNotMatch(overlay, /^networks:/m, "no new network is needed");
});

test("gateway has exactly the privileges the spec allows", () => {
  const vpn = serviceBlocks(overlay).get("vpn").join("\n");
  assert.match(vpn, /cap_add:\s*\n\s+- NET_ADMIN/);
  assert.match(vpn, /devices:\s*\n\s+- "\/dev\/ppp:\/dev\/ppp"/);
  assert.match(vpn, /net\.ipv4\.ip_forward: "1"/);
  assert.doesNotMatch(vpn, /privileged/);
});

test("overlay pulls the published image and never builds", () => {
  assert.match(overlay, /image: \$\{VPN_IMAGE:-/);
  assert.doesNotMatch(overlay, /^\s+build:/m);
});

test("sidecars join the target namespaces and can set routes", () => {
  const services = serviceBlocks(overlay);
  const paseoRoute = services.get("paseo-vpn-route").join("\n");
  const browserRoute = services.get("browser-vpn-route").join("\n");
  assert.match(paseoRoute, /network_mode: "service:paseo"/);
  assert.match(browserRoute, /network_mode: "service:browser"/);
  for (const block of [paseoRoute, browserRoute]) {
    assert.match(block, /cap_add:\s*\n\s+- NET_ADMIN/);
    assert.match(block, /paseo-vpn-route --check/);
  }
});

test("sidecars target the gateway by container name, not service name", () => {
  const services = serviceBlocks(overlay);
  for (const name of ["paseo-vpn-route", "browser-vpn-route"]) {
    const block = services.get(name).join("\n");
    assert.match(block, /VPN_GATEWAY_CONTAINER: \$\{INSTANCE_NAME:-paseo\}-vpn/);
  }
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test scripts/vpn-overlay.test.mjs`

Expected: the six new tests fail — the overlay file does not exist.

- [ ] **Step 3: Write the overlay**

Create `docker/docker-compose.vpn.yml`:

```yaml
# Optional private-network access, applied on top of docker-compose.yml:
#
#   docker compose -f docker-compose.yml -f docker-compose.vpn.yml up -d
#
# Without the second -f, none of this exists and the stack is unchanged. This
# file adds services and modifies none, so applying it recreates nothing.
#
# The tunnel lives only in the `vpn` container's network namespace. The host's
# routing table and resolv.conf are never touched, which is the whole point:
# running the client on a host is what locked the server out to begin with.
#
# Requires ppp_generic on the host:
#   modprobe ppp_generic && echo ppp_generic > /etc/modules-load.d/ppp.conf
services:
  # SSL-VPN client and routed gateway. Everything reaching the private network
  # is masqueraded out of ppp0 here.
  vpn:
    image: ${VPN_IMAGE:-ghcr.io/allrested/paseo-vpn:latest}
    pull_policy: always
    container_name: ${INSTANCE_NAME:-paseo}-vpn
    restart: unless-stopped
    cap_add:
      - NET_ADMIN
    devices:
      - "/dev/ppp:/dev/ppp"
    sysctls:
      net.ipv4.ip_forward: "1"
    environment:
      VPN_GATEWAY: ${VPN_GATEWAY:?VPN_GATEWAY is required}
      VPN_PORT: ${VPN_PORT:-443}
      VPN_USERNAME: ${VPN_USERNAME:?VPN_USERNAME is required}
      VPN_PASSWORD: ${VPN_PASSWORD:?VPN_PASSWORD is required}
      VPN_TRUSTED_CERT: ${VPN_TRUSTED_CERT:-}
      VPN_REALM: ${VPN_REALM:-}
      # Curated, never copied from the gateway. Most of what the gateway offers
      # is public address space; installing it would route parts of the
      # internet through the corporate tunnel. Validated at startup: RFC 1918
      # only, /12 or longer, no overlap with this container's own networks.
      INTERNAL_CIDRS: ${INTERNAL_CIDRS:?INTERNAL_CIDRS is required}
      VPN_HEALTH_TARGET: ${VPN_HEALTH_TARGET:-}
    # Health means the private network answers. A ppp0 that exists while
    # routing nowhere reports unhealthy instead of lying.
    healthcheck:
      test: ["CMD", "/usr/local/bin/paseo-vpn-healthcheck"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 60s

  # Routes for paseo, installed from inside its namespace so paseo itself needs
  # no capabilities. Same idiom as paseo-cdp in docker-compose.yml.
  paseo-vpn-route:
    image: ${VPN_IMAGE:-ghcr.io/allrested/paseo-vpn:latest}
    pull_policy: always
    container_name: ${INSTANCE_NAME:-paseo}-vpn-route
    restart: unless-stopped
    network_mode: "service:paseo"
    cap_add:
      - NET_ADMIN
    depends_on:
      - paseo
      - vpn
    entrypoint: ["/usr/local/bin/paseo-vpn-route"]
    environment:
      INTERNAL_CIDRS: ${INTERNAL_CIDRS:?INTERNAL_CIDRS is required}
      # Container name, not service name: on a shared proxy network every
      # instance's `vpn` service carries the same DNS alias, so a service name
      # can resolve to another instance's gateway.
      VPN_GATEWAY_CONTAINER: ${INSTANCE_NAME:-paseo}-vpn
    # Recreating paseo leaves this sidecar in the old namespace, Up and useless.
    # The check only passes from the live namespace, so a zombie goes unhealthy.
    # Recover with:
    #   docker compose ... up -d --force-recreate paseo-vpn-route
    healthcheck:
      test: ["CMD", "/usr/local/bin/paseo-vpn-route", "--check"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 20s

  # The same, for the shared browser, so internal web UIs load over noVNC.
  browser-vpn-route:
    image: ${VPN_IMAGE:-ghcr.io/allrested/paseo-vpn:latest}
    pull_policy: always
    container_name: ${INSTANCE_NAME:-paseo}-browser-vpn-route
    restart: unless-stopped
    network_mode: "service:browser"
    cap_add:
      - NET_ADMIN
    depends_on:
      - browser
      - vpn
    entrypoint: ["/usr/local/bin/paseo-vpn-route"]
    environment:
      INTERNAL_CIDRS: ${INTERNAL_CIDRS:?INTERNAL_CIDRS is required}
      VPN_GATEWAY_CONTAINER: ${INSTANCE_NAME:-paseo}-vpn
    healthcheck:
      test: ["CMD", "/usr/local/bin/paseo-vpn-route", "--check"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 20s
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test scripts/vpn-overlay.test.mjs`

Expected: PASS, 30 tests.

- [ ] **Step 5: Validate the merged Compose config**

Run, from `docker/`, with a `.env` present:

```bash
docker compose -f docker-compose.yml -f docker-compose.vpn.yml config > /tmp/merged.yml
```

Expected: exits `0`. If Docker is unavailable locally, skip and record it — Task 8 runs this on the server.

- [ ] **Step 6: Confirm the overlay changes nothing when unused**

```bash
git stash
docker compose -f docker-compose.yml config > /tmp/before.yml
git stash pop
docker compose -f docker-compose.yml config > /tmp/after.yml
diff /tmp/before.yml /tmp/after.yml
```

Expected: no output. Same caveat as Step 5 if Docker is unavailable.

- [ ] **Step 7: Format and commit**

```bash
npm run format:files -- docker/docker-compose.vpn.yml scripts/vpn-overlay.test.mjs
git add docker/docker-compose.vpn.yml scripts/vpn-overlay.test.mjs
git commit -m "feat(docker): add optional private-network compose overlay"
```

---

### Task 6: SSH plumbing in the agents image

**Files:**

- Create: `docker/agents/rootfs/usr/local/bin/paseo-agents-ssh-setup`
- Modify: `docker/Dockerfile.agents`
- Modify: `scripts/vpn-overlay.test.mjs`

**Interfaces:**

- Consumes: nothing.
- Produces: `paseo-agents-ssh-setup`. Reads `INTERNAL_SSH_HOST`, `INTERNAL_SSH_KEY_FILE`, `SSH_KNOWN_HOSTS_EXTRA` (`\n`-separated), and `--root DIR` (default `/`) to redirect writes for tests. Writes `<root>/etc/ssh/ssh_config.d/10-internal.conf` and `<root>/etc/ssh/ssh_known_hosts.extra`. Exits `0` writing nothing when `INTERNAL_SSH_HOST` is unset, so the stack is unaffected without the overlay.

- [ ] **Step 1: Write the failing test**

Append to `scripts/vpn-overlay.test.mjs`:

```javascript
import { mkdtempSync, readFileSync as readFile, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const sshSetupPath = fileURLToPath(
  new URL("docker/agents/rootfs/usr/local/bin/paseo-agents-ssh-setup", repoRoot),
);

function runSshSetup(env) {
  const root = mkdtempSync(join(tmpdir(), "paseo-ssh-"));
  const result = runScript(sshSetupPath, env, ["--root", root]);
  return { ...result, root };
}

test("ssh setup writes the host block and known hosts", () => {
  const { code, root, stderr } = runSshSetup({
    INTERNAL_SSH_HOST: "git.example.com",
    INTERNAL_SSH_KEY_FILE: "/home/paseo/.ssh/internal_key",
    SSH_KNOWN_HOSTS_EXTRA: "git.example.com ssh-ed25519 AAAA\\ngit.example.com ssh-rsa BBBB",
  });
  assert.equal(code, 0, stderr);

  const config = readFile(join(root, "etc/ssh/ssh_config.d/10-internal.conf"), "utf8");
  assert.match(config, /^Host git\.example\.com$/m);
  assert.match(config, /IdentityFile \/home\/paseo\/\.ssh\/internal_key/);
  assert.match(config, /IdentitiesOnly yes/);
  assert.match(
    config,
    /GlobalKnownHostsFile \/etc\/ssh\/ssh_known_hosts \/etc\/ssh\/ssh_known_hosts\.extra/,
  );

  // Escaped separators become real newlines: .env parsing across compose
  // versions does not carry literal newlines reliably.
  const known = readFile(join(root, "etc/ssh/ssh_known_hosts.extra"), "utf8");
  assert.deepEqual(known.trim().split("\n"), [
    "git.example.com ssh-ed25519 AAAA",
    "git.example.com ssh-rsa BBBB",
  ]);
});

test("ssh setup keeps IdentitiesOnly inside the Host block", () => {
  const { root } = runSshSetup({
    INTERNAL_SSH_HOST: "git.example.com",
    INTERNAL_SSH_KEY_FILE: "/home/paseo/.ssh/internal_key",
    SSH_KNOWN_HOSTS_EXTRA: "",
  });
  const config = readFile(join(root, "etc/ssh/ssh_config.d/10-internal.conf"), "utf8");
  const hostLine = config.split("\n").findIndex((line) => /^Host /.test(line));
  const identitiesOnly = config.split("\n").findIndex((line) => /IdentitiesOnly/.test(line));
  // Applied globally, IdentitiesOnly breaks GitHub authentication.
  assert.ok(hostLine >= 0 && identitiesOnly > hostLine);
});

test("ssh setup does nothing without INTERNAL_SSH_HOST", () => {
  const { code, root, stderr } = runSshSetup({ INTERNAL_SSH_HOST: "" });
  assert.equal(code, 0, stderr);
  assert.ok(!existsSync(join(root, "etc/ssh/ssh_config.d/10-internal.conf")));
});

test("agents image installs and invokes the ssh setup script", () => {
  const dockerfile = readFile(fileURLToPath(new URL("docker/Dockerfile.agents", repoRoot)), "utf8");
  assert.match(dockerfile, /COPY agents\/rootfs\/ \//);
  assert.match(dockerfile, /paseo-agents-ssh-setup/);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test scripts/vpn-overlay.test.mjs`

Expected: the four new tests fail.

- [ ] **Step 3: Write the SSH setup script**

Create `docker/agents/rootfs/usr/local/bin/paseo-agents-ssh-setup`:

```bash
#!/usr/bin/env bash
# Configures SSH for a private Git server from the environment, at every start.
#
# Writes into an image layer rather than the mounted /home/paseo volume, so
# rewriting the same file each start is idempotent with no dedupe logic.
#
# Without the known-hosts entry the first clone fails with "Host key
# verification failed": Dockerfile.agents pins GitHub's keys and nothing else.
set -euo pipefail

root=/
if [ "${1:-}" = "--root" ]; then
  root=$2
fi

host=${INTERNAL_SSH_HOST:-}
[ -n "$host" ] || exit 0

key_file=${INTERNAL_SSH_KEY_FILE:-/home/paseo/.ssh/internal_key}
config_dir="${root%/}/etc/ssh/ssh_config.d"
known_hosts="${root%/}/etc/ssh/ssh_known_hosts.extra"

mkdir -p "$config_dir" "$(dirname "$known_hosts")"

# IdentitiesOnly stays scoped to this Host block. Applied globally it stops
# GitHub authentication from working.
cat > "$config_dir/10-internal.conf" <<CONFIG
Host $host
  IdentityFile $key_file
  IdentitiesOnly yes
GlobalKnownHostsFile /etc/ssh/ssh_known_hosts /etc/ssh/ssh_known_hosts.extra
CONFIG
chmod 644 "$config_dir/10-internal.conf"

if [ -n "${SSH_KNOWN_HOSTS_EXTRA:-}" ]; then
  printf '%b\n' "$SSH_KNOWN_HOSTS_EXTRA" > "$known_hosts"
  chmod 644 "$known_hosts"
fi
```

- [ ] **Step 4: Wire it into the agents image**

In `docker/Dockerfile.agents`, before the final `RUN` heredoc that generates `paseo-agents-entrypoint`, add:

```dockerfile
# SSH configuration for an optional private Git server, applied at start from
# the environment. See docker/docker-compose.vpn.yml.
COPY agents/rootfs/ /
RUN set -eux; \
    sed -i 's/\r$//' /usr/local/bin/paseo-agents-ssh-setup; \
    chmod +x /usr/local/bin/paseo-agents-ssh-setup; \
    bash -n /usr/local/bin/paseo-agents-ssh-setup
```

Then, inside the generated `paseo-agents-entrypoint` heredoc, add this line immediately before its final `exec`:

```sh
/usr/local/bin/paseo-agents-ssh-setup
```

The entrypoint runs as root at that point, which is what writing under `/etc/ssh` needs. It exits `0` doing nothing when `INTERNAL_SSH_HOST` is unset, so deployments without the overlay are unaffected.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test scripts/vpn-overlay.test.mjs`

Expected: PASS, 34 tests.

- [ ] **Step 6: Commit**

```bash
npm run format:files -- scripts/vpn-overlay.test.mjs
git add docker/agents docker/Dockerfile.agents scripts/vpn-overlay.test.mjs
git commit -m "feat(docker): configure SSH for a private git server from env"
```

---

### Task 7: Configuration example and documentation

**Files:**

- Modify: `docker/.env.example`
- Modify: `docker/README.md`
- Modify: `docs/docker.md`
- Modify: `scripts/vpn-overlay.test.mjs`

**Interfaces:**

- Consumes: every variable introduced in Tasks 3-6.
- Produces: no runtime interface. The drift test below is what later changes rely on.

- [ ] **Step 1: Write the failing test**

Append to `scripts/vpn-overlay.test.mjs`:

```javascript
const envExample = readFile(fileURLToPath(new URL("docker/.env.example", repoRoot)), "utf8");

test("every overlay variable is documented in .env.example", () => {
  const referenced = new Set(
    [...overlay.matchAll(/\$\{([A-Z0-9_]+)(?::[-?][^}]*)?\}/g)].map((m) => m[1]),
  );
  // Declared by docker-compose.yml, not the overlay.
  referenced.delete("INSTANCE_NAME");
  const missing = [...referenced].filter(
    (name) => !new RegExp(`^#?\\s*${name}=`, "m").test(envExample),
  );
  assert.deepEqual(missing, [], `undocumented variables: ${missing.join(", ")}`);
});

test("env example carries only placeholder values", () => {
  // Real values live in docker/.env, which is gitignored. Example CIDRs have to
  // parse, so addresses are allowed — but only private ones, which also keeps
  // the examples consistent with what the curation guard accepts.
  const addresses = [...envExample.matchAll(/\b(\d{1,3}(?:\.\d{1,3}){3})\b/g)].map((m) => m[1]);
  const publicAddresses = addresses.filter(
    (address) =>
      !/^10\./.test(address) &&
      !/^192\.168\./.test(address) &&
      !/^172\.(1[6-9]|2\d|3[01])\./.test(address),
  );
  assert.deepEqual(publicAddresses, [], `public addresses in .env.example: ${publicAddresses}`);

  // Every hostname default must be a reserved example name. Naming the real
  // hostnames to forbid them would put them in a tracked file, which is the
  // thing being prevented — so this asserts the allowed shape instead.
  for (const name of ["VPN_GATEWAY", "VPN_HEALTH_TARGET", "INTERNAL_SSH_HOST"]) {
    const value = new RegExp(`^${name}=(.*)$`, "m").exec(envExample)?.[1] ?? "";
    const host = value.split(":")[0];
    assert.ok(
      host === "" || host.endsWith("example.com"),
      `${name} default must be an example.com placeholder, found: ${host}`,
    );
  }
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test scripts/vpn-overlay.test.mjs`

Expected: the drift test fails, listing every new variable.

- [ ] **Step 3: Extend `.env.example`**

Append to `docker/.env.example`:

```bash
# ---------------------------------------------------------------------------
# Private network access (optional)
# ---------------------------------------------------------------------------
# Only used with the VPN overlay:
#   docker compose -f docker-compose.yml -f docker-compose.vpn.yml up -d
#
# Requires ppp_generic on the host:
#   modprobe ppp_generic && echo ppp_generic > /etc/modules-load.d/ppp.conf

VPN_IMAGE=ghcr.io/allrested/paseo-vpn:latest

# FortiGate SSL-VPN gateway.
VPN_GATEWAY=vpn.example.com
VPN_PORT=443
VPN_USERNAME=
VPN_PASSWORD=

# Gateway certificate SHA256. Leave empty on the first connect: the client
# refuses the unknown certificate and prints the digest to paste here. Pinning
# it is what prevents a machine-in-the-middle.
VPN_TRUSTED_CERT=

# Set only if the portal is realm-scoped. A missing realm fails authentication
# in a way that looks like a wrong password.
VPN_REALM=

# What "internal" means, comma-separated. Curate this by hand — a gateway
# typically offers far more, including public address space, and installing
# that would route parts of the internet through the tunnel. Validated at
# startup: RFC 1918 only, /12 or longer, no overlap with the container's own
# networks.
INTERNAL_CIDRS=10.0.0.0/16

# host:port the gateway healthcheck connects to through the tunnel.
VPN_HEALTH_TARGET=git.internal.example.com:22

# Git over SSH to the private server.
INTERNAL_SSH_HOST=git.internal.example.com
INTERNAL_SSH_KEY_FILE=./internal-ssh-key
# From `ssh-keyscan <host>` run while the tunnel is up. Separate entries with
# \n — .env parsing across compose versions does not carry real newlines.
SSH_KNOWN_HOSTS_EXTRA=
```

Every example address here is private, which is what the placeholder test checks and what the curation guard would accept — an example that the guard rejects teaches the wrong default.

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test scripts/vpn-overlay.test.mjs`

Expected: PASS, 36 tests.

- [ ] **Step 5: Document the overlay in `docker/README.md`**

Add a section after "The browser". Follow the file's existing voice — short, second person, tables for options. Cover: what the overlay does, the one command to apply it, the host `ppp_generic` prerequisite, that `INTERNAL_CIDRS` is curated by hand and why, the deploy-key file mode requirement (`chown 1000:1000`, `chmod 600`), and the `--force-recreate` recovery when a route sidecar goes unhealthy after `paseo` is recreated.

- [ ] **Step 6: Document it in `docs/docker.md`**

Add a "Private network access" section after "Reverse Proxies". Same content, aimed at an operator who has not read the spec. Do not restate what `docker/README.md` says — link to it. Per `CLAUDE.md`: one fact, one doc.

- [ ] **Step 7: Format and commit**

```bash
npm run format:files -- docker/README.md docs/docker.md scripts/vpn-overlay.test.mjs
node --test scripts/vpn-overlay.test.mjs
git add docker/.env.example docker/README.md docs/docker.md scripts/vpn-overlay.test.mjs
git commit -m "docs(docker): document the private-network overlay"
```

---

### Task 8: Server verification

No automated test covers this. It runs on the deployment host, once, and its first item is the acceptance test for the whole feature.

**Files:** none. Record the results in the pull request.

**Interfaces:**

- Consumes: the published image from Task 4 and a populated `docker/.env`.
- Produces: evidence.

- [ ] **Step 1: Confirm the host prerequisites**

```bash
sudo modprobe ppp_generic
ls -l /dev/ppp
echo ppp_generic | sudo tee /etc/modules-load.d/ppp.conf
systemctl list-unit-files | grep -i -E 'forti|ppp' || echo "no host VPN units"
ls /etc/ppp/ 2>/dev/null || echo "no host ppp config"
```

Expected: `/dev/ppp` exists. Any leftover host-level VPN unit must be stopped **and disabled** — it would reinstall its routes on the next boot and reproduce the original lockout independently of this stack.

- [ ] **Step 2: Capture the host baseline**

```bash
ip route show > /tmp/host-routes.before
cp /etc/resolv.conf /tmp/host-resolv.before
```

- [ ] **Step 3: Prove the curation guard rejects a bad range**

```bash
cd docker
INTERNAL_CIDRS=10.0.0.0/8 docker compose -f docker-compose.yml -f docker-compose.vpn.yml \
  run --rm vpn || echo "rejected as expected"
```

Expected: the container exits naming the range and the `/12` rule. Run this before the good path — a guard nobody has seen fire is a guard nobody knows works.

- [ ] **Step 4: Start the overlay**

```bash
docker compose -f docker-compose.yml -f docker-compose.vpn.yml pull
docker compose -f docker-compose.yml -f docker-compose.vpn.yml up -d
docker compose -f docker-compose.yml -f docker-compose.vpn.yml ps
```

Expected: `vpn` and both route sidecars healthy. No existing container was recreated.

On the first run `VPN_TRUSTED_CERT` is empty and the client will refuse the gateway certificate, printing the expected digest. Put it in `.env` and repeat this step.

- [ ] **Step 5: Assert the host invariant**

```bash
ip route show | diff /tmp/host-routes.before -
diff /etc/resolv.conf /tmp/host-resolv.before
```

Expected: no output from either. **This is the acceptance test for the feature.** If either diff is non-empty, stop and treat it as a defect.

- [ ] **Step 6: Check the tunnel carries only the declared routes**

```bash
docker compose -f docker-compose.yml -f docker-compose.vpn.yml exec vpn ip -4 addr show ppp0
docker compose -f docker-compose.yml -f docker-compose.vpn.yml exec vpn ip route show
```

Expected: `ppp0` has an address; the declared CIDRs appear on `ppp0`; there is no `default` route via `ppp0`.

- [ ] **Step 7: Check access and internet from `paseo`**

```bash
C=$(docker compose -f docker-compose.yml -f docker-compose.vpn.yml ps -q paseo)
docker exec "$C" getent hosts "$INTERNAL_SSH_HOST"
docker exec "$C" nc -z -w 5 "$INTERNAL_SSH_HOST" 22 && echo "private network reachable"
docker exec "$C" getent hosts "${INSTANCE_NAME:-paseo}-browser"
docker exec "$C" curl -sfI https://api.anthropic.com -o /dev/null && echo "internet intact"
```

Expected: all four succeed. The third and fourth are the ones that matter — they prove the overlay did not cost the container its container-name resolution or its path to the internet.

- [ ] **Step 8: Clone over SSH**

```bash
docker exec -u paseo "$C" ssh -T "git@$INTERNAL_SSH_HOST" || true
docker exec -u paseo "$C" git clone "git@$INTERNAL_SSH_HOST:<group>/<small-repo>.git" /tmp/clone-check
```

Expected: the host key is accepted without a prompt, authentication succeeds, and the clone completes. A `Host key verification failed` here means `SSH_KNOWN_HOSTS_EXTRA` did not reach the container.

- [ ] **Step 9: Check the browser**

Open `http://<host>:${BROWSER_PORT}` and load the private web UI, then a public site. Expected: both render.

- [ ] **Step 10: Run the failure drill**

```bash
docker stop "${INSTANCE_NAME:-paseo}-vpn"
docker exec "$C" curl -sfI https://api.anthropic.com -o /dev/null && echo "internet survives"
docker exec "$C" getent hosts "${INSTANCE_NAME:-paseo}-browser" && echo "DNS survives"
docker start "${INSTANCE_NAME:-paseo}-vpn"
sleep 60
docker exec "$C" nc -z -w 5 "$INTERNAL_SSH_HOST" 22 && echo "private access returned"
```

Expected: with the gateway stopped, internet and DNS still work — only private routing is lost. After restart, private access returns with no other action.

- [ ] **Step 11: Assert the host invariant again after teardown**

```bash
docker compose -f docker-compose.yml -f docker-compose.vpn.yml down
ip route show | diff /tmp/host-routes.before -
diff /etc/resolv.conf /tmp/host-resolv.before
```

Expected: no output.

- [ ] **Step 12: Record the evidence**

Paste the outputs of Steps 3, 5, 7, 10, and 11 into the pull request. Steps 5 and 11 are the two that decide whether this shipped.

---

## Self-Review

**Spec coverage:**

| Spec section                                                 | Task                                         |
| ------------------------------------------------------------ | -------------------------------------------- |
| Route curation, all three rules                              | 1 (validator, tests), 8 Step 3 (guard fires) |
| Gateway image                                                | 4                                            |
| Gateway entrypoint, config, NAT, retry loop                  | 3                                            |
| Route installation via `ip-up.d`, no default route           | 3 (hook + test), 8 Step 6                    |
| Resolution — no DNS component                                | 5 (test asserts no `dns:` key)               |
| Networking — no new network                                  | 5 (test asserts no `networks:` block)        |
| Route sidecars, container-name targeting, zombie healthcheck | 2, 5                                         |
| Composition — purely additive overlay                        | 5 (tests + Steps 5-6)                        |
| SSH access, `ssh_config.d`, known hosts                      | 6                                            |
| Configuration table                                          | 7 (drift test)                               |
| Health — both healthchecks                                   | 3, 5                                         |
| Failure behaviour                                            | 8 Step 10                                    |
| Host prerequisites                                           | 8 Step 1                                     |
| Publishing                                                   | 4                                            |
| Verification, all nine items                                 | 8                                            |

No spec section is unimplemented.

**Placeholder scan:** the only bracketed placeholders are `<group>/<small-repo>` in Task 8 Step 8 and `<host>` in Step 9, which are operator inputs rather than unfinished plan content. Task 7 Steps 5-6 describe documentation content rather than supplying prose, which is deliberate — the two files have an established voice that `CLAUDE.md` governs, and pre-writing paragraphs here would invite pasting them past that gate.

**Type consistency:** `INTERNAL_CIDRS`, `VPN_GATEWAY_CONTAINER`, `PASEO_VPN_GATEWAY_ADDR`, `PASEO_VPN_LOCAL_ADDRS`, `PASEO_VPN_DRY_RUN`, `VPN_HEALTH_TARGET`, `INTERNAL_SSH_HOST`, `INTERNAL_SSH_KEY_FILE`, and `SSH_KNOWN_HOSTS_EXTRA` carry the same names across Tasks 1-7 and match the spec's configuration table. `paseo-vpn-route` is invoked as a bare command in Task 2's tests and as an `entrypoint` plus `--check` healthcheck in Task 5, which its argument handling supports. `runScript` is defined in Task 3 and reused in Task 6 — Task 6 must be implemented after Task 3, which the ordering already requires.

**One risk to flag for the executor:** Task 5 Steps 5-6 and all of Task 8 need Docker. If the implementing environment has none, those steps are deferred to the server rather than skipped. The Node contract tests cover file structure and invariants, not runtime behaviour, so a green test run is not evidence the tunnel works.
