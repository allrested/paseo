import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
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

test("validator rejects a multi-line value even when the first line is a valid CIDR", () => {
  const result = runValidate({
    ...LOCAL,
    INTERNAL_CIDRS: "10.4.0.0/16\ntouch /tmp/paseo-vpn-test-marker",
  });
  assert.equal(result.code, 1);
});

test("validator rejects a value containing a quote and a semicolon", () => {
  const result = runValidate({ ...LOCAL, INTERNAL_CIDRS: "10.4.0.0/16;'" });
  assert.equal(result.code, 1);
});

const routePath = fileURLToPath(
  new URL("docker/vpn/rootfs/usr/local/bin/paseo-vpn-route", repoRoot),
);

function runRoute(env, args = []) {
  const result = spawnSync("bash", [routePath, ...args], {
    encoding: "utf8",
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  return {
    code: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

const DRY = {
  PASEO_VPN_DRY_RUN: "1",
  PASEO_VPN_GATEWAY_ADDR: "172.18.0.9",
  // paseo-vpn-route now runs the curation guard before doing anything else.
  // Without this seam it would shell out to the real `ip` command, which
  // this test's environment does not have.
  PASEO_VPN_LOCAL_ADDRS: "172.18.0.5/16,127.0.0.1/8",
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
    PASEO_VPN_LOCAL_ADDRS: "172.18.0.5/16,127.0.0.1/8",
    INTERNAL_CIDRS: "10.4.0.0/16",
    VPN_GATEWAY_CONTAINER: "",
  });
  assert.equal(result.code, 1);
  assert.match(result.stderr, /VPN_GATEWAY_CONTAINER is required/);
});

test("route sidecar rejects a CIDR that overlaps its own namespace's addresses", () => {
  // Reproduces the Critical defect: a range that collides with a network only
  // paseo is on (dokploy-network, standing in here for any address the
  // gateway container cannot see) must be caught inside the sidecar, since
  // the gateway's own curation check never sees that namespace.
  const result = runRoute({
    ...DRY,
    PASEO_VPN_LOCAL_ADDRS: "10.0.1.5/24",
    INTERNAL_CIDRS: "10.0.0.0/16",
  });
  assert.equal(result.code, 1);
  assert.match(result.stderr, /overlaps this container's own network/);
});

test("route sidecar --check reports the routes it would verify", () => {
  const result = runRoute({ ...DRY, INTERNAL_CIDRS: "10.4.0.0/16" }, ["--check"]);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /ip route show 10\.4\.0\.0\/16/);
});

test("route sidecar recovers from transient gateway failures", () => {
  const result = runRoute({
    ...DRY,
    PASEO_VPN_ROUTE_INTERVAL: "0",
    PASEO_VPN_FAIL_ON_PASS: "2",
    PASEO_VPN_MAX_PASSES: "3",
    INTERNAL_CIDRS: "10.4.0.0/16",
  });
  assert.equal(result.code, 0, result.stderr);
  // Verify failure on pass 2 was logged
  assert.match(result.stderr, /pass 2.*injected failure/);
  // Verify failure was recovered - pass 2 failed and pass 3 succeeded
  assert.match(result.stderr, /pass 2 failed, retrying/);
  // Verify pass 3 output shows the route command was executed
  assert.match(result.stdout, /ip route replace 10\.4\.0\.0\/16/);
});

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

test("route hook falls back to PASEO_VPN_ENV_FILE when INTERNAL_CIDRS is unset", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "paseo-vpn-"));
  const envFile = path.join(dir, "paseo-vpn.env");
  writeFileSync(envFile, "INTERNAL_CIDRS=10.4.0.0/16,10.15.0.0/16\n");

  const result = runScript(ipUpPath, {
    PASEO_VPN_DRY_RUN: "1",
    INTERNAL_CIDRS: "",
    PASEO_VPN_ENV_FILE: envFile,
  });
  assert.equal(result.code, 0, result.stderr);
  const lines = result.stdout.trim().split("\n");
  assert.deepEqual(lines, [
    "ip route replace 10.4.0.0/16 dev ppp0",
    "ip route replace 10.15.0.0/16 dev ppp0",
  ]);
});

test("route hook does not execute a command smuggled in via the env file", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "paseo-vpn-"));
  const envFile = path.join(dir, "paseo-vpn.env");
  const markerPath = path.join(dir, "marker");

  // Mirrors the quoting paseo-vpn-entrypoint uses when persisting
  // INTERNAL_CIDRS: the whole value is wrapped in single quotes, so an
  // embedded newline (and whatever follows it) stays part of the string
  // instead of becoming a second command when the hook `source`s this file.
  writeFileSync(envFile, `INTERNAL_CIDRS='10.4.0.0/16\ntouch ${markerPath}'\n`);

  const result = runScript(ipUpPath, {
    PASEO_VPN_DRY_RUN: "1",
    INTERNAL_CIDRS: "",
    PASEO_VPN_ENV_FILE: envFile,
  });
  assert.equal(result.code, 0, result.stderr);
  assert.equal(existsSync(markerPath), false);
});

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

// Normalised: this repo checks out CRLF on Windows, and the drift check
// below compares these two files line by line.
const vpnStack = readFileSync(
  fileURLToPath(new URL("docker/docker-compose.vpn.yml", repoRoot)),
  "utf8",
).replace(/\r\n/g, "\n");

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

test("the VPN stack is self-contained: base services plus the VPN services", () => {
  // A deploy tool that accepts one compose path cannot express an overlay, and
  // Dokploy does not resolve Compose `include:` — it reported "Services not
  // found" and every attached domain failed validation. So this file declares
  // the whole stack.
  const services = serviceBlocks(vpnStack);
  assert.deepEqual([...services.keys()].sort(), [
    "browser",
    "browser-cdp",
    "browser-vpn-route",
    "paseo",
    "paseo-cdp",
    "paseo-vpn-route",
    "vpn",
  ]);
});

test("the base stack carries no VPN services", () => {
  // Instances that do not need the VPN must be untouched by it.
  const services = serviceBlocks(baseCompose);
  for (const name of ["vpn", "paseo-vpn-route", "browser-vpn-route"]) {
    assert.ok(!services.has(name), `${name} must not appear in docker-compose.yml`);
  }
});

test("shared services stay identical between the base stack and the VPN stack", () => {
  // The four are duplicated on purpose. Duplication drifts unless something
  // watches it, and a drifted paseo definition would deploy a different daemon
  // depending on which file the instance points at.
  // A block runs until the next service key, so it absorbs any blank lines and
  // comments introducing whatever follows. Those belong to the next section,
  // not to this service.
  const body = (lines) => {
    const out = [...(lines ?? [])];
    while (out.length && /^\s*(#.*)?$/.test(out[out.length - 1])) out.pop();
    return out;
  };
  const base = serviceBlocks(baseCompose);
  const vpn = serviceBlocks(vpnStack);
  for (const name of ["paseo", "browser", "browser-cdp", "paseo-cdp"]) {
    assert.deepEqual(
      body(vpn.get(name)),
      body(base.get(name)),
      `service "${name}" differs between docker-compose.yml and docker-compose.vpn.yml`,
    );
  }
});

test("the VPN stack keeps the DNS and network decisions the design settled", () => {
  assert.doesNotMatch(vpnStack, /^\s+dns:/m, "no DNS override: public DNS already resolves");
  const vpnBlock = serviceBlocks(vpnStack).get("vpn").join("\n");
  assert.doesNotMatch(vpnBlock, /networks:/, "the gateway joins the default network implicitly");
});

test("gateway has exactly the privileges the spec allows", () => {
  const vpn = serviceBlocks(vpnStack).get("vpn").join("\n");
  assert.match(vpn, /cap_add:\s*\n\s+- NET_ADMIN/);
  assert.match(vpn, /devices:\s*\n\s+- "\/dev\/ppp:\/dev\/ppp"/);
  assert.match(vpn, /net\.ipv4\.ip_forward: "1"/);
  assert.doesNotMatch(vpn, /privileged/);
});

test("the VPN stack pulls the published image and never builds", () => {
  assert.match(vpnStack, /image: \$\{VPN_IMAGE:-/);
  assert.doesNotMatch(vpnStack, /^\s+build:/m);
});

test("sidecars join the target namespaces and can set routes", () => {
  const services = serviceBlocks(vpnStack);
  const paseoRoute = services.get("paseo-vpn-route").join("\n");
  const browserRoute = services.get("browser-vpn-route").join("\n");
  assert.match(paseoRoute, /network_mode: "service:paseo"/);
  assert.match(browserRoute, /network_mode: "service:browser"/);
  for (const block of [paseoRoute, browserRoute]) {
    assert.match(block, /cap_add:\s*\n\s+- NET_ADMIN/);
    assert.match(block, /paseo-vpn-route",\s*"--check"/);
    // tini must stay PID 1: without it the sidecar has no SIGTERM handler and
    // `docker compose down` waits out the full stop timeout on every sidecar.
    assert.match(
      block,
      /entrypoint: \["\/usr\/bin\/tini", "--", "\/usr\/local\/bin\/paseo-vpn-route"\]/,
    );
  }
});

test("sidecars target the gateway by container name, not service name", () => {
  const services = serviceBlocks(vpnStack);
  for (const name of ["paseo-vpn-route", "browser-vpn-route"]) {
    const block = services.get(name).join("\n");
    assert.match(block, /VPN_GATEWAY_CONTAINER: \$\{INSTANCE_NAME:-paseo\}-vpn/);
  }
});

const sshSetupPath = fileURLToPath(
  new URL("docker/agents/rootfs/usr/local/bin/paseo-agents-ssh-setup", repoRoot),
);

function runSshSetup(env) {
  const root = mkdtempSync(path.join(tmpdir(), "paseo-ssh-"));
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

  const config = readFileSync(path.join(root, "etc/ssh/ssh_config.d/10-internal.conf"), "utf8");
  assert.match(config, /^Host git\.example\.com$/m);
  assert.match(config, /IdentityFile \/home\/paseo\/\.ssh\/internal_key/);
  assert.match(config, /IdentitiesOnly yes/);
  assert.match(
    config,
    /GlobalKnownHostsFile \/etc\/ssh\/ssh_known_hosts \/etc\/ssh\/ssh_known_hosts\.extra/,
  );

  // Escaped separators become real newlines: .env parsing across compose
  // versions does not carry literal newlines reliably.
  const known = readFileSync(path.join(root, "etc/ssh/ssh_known_hosts.extra"), "utf8");
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
  const config = readFileSync(path.join(root, "etc/ssh/ssh_config.d/10-internal.conf"), "utf8");
  const hostLine = config.split("\n").findIndex((line) => line.startsWith("Host "));
  const identitiesOnly = config.split("\n").findIndex((line) => /IdentitiesOnly/.test(line));
  // Applied globally, IdentitiesOnly breaks GitHub authentication.
  assert.ok(hostLine >= 0 && identitiesOnly > hostLine);
});

test("ssh setup does nothing without INTERNAL_SSH_HOST", () => {
  const { code, root, stderr } = runSshSetup({ INTERNAL_SSH_HOST: "" });
  assert.equal(code, 0, stderr);
  assert.ok(!existsSync(path.join(root, "etc/ssh/ssh_config.d/10-internal.conf")));
});

test("ssh setup clears stale known hosts when the env var is emptied on restart", () => {
  const root = mkdtempSync(path.join(tmpdir(), "paseo-ssh-"));
  const base = {
    INTERNAL_SSH_HOST: "git.example.com",
    INTERNAL_SSH_KEY_FILE: "/home/paseo/.ssh/internal_key",
  };

  const first = runScript(
    sshSetupPath,
    { ...base, SSH_KNOWN_HOSTS_EXTRA: "git.example.com ssh-ed25519 AAAA" },
    ["--root", root],
  );
  assert.equal(first.code, 0, first.stderr);
  assert.match(
    readFileSync(path.join(root, "etc/ssh/ssh_known_hosts.extra"), "utf8"),
    /git\.example\.com ssh-ed25519 AAAA/,
  );

  const second = runScript(sshSetupPath, { ...base, SSH_KNOWN_HOSTS_EXTRA: "" }, ["--root", root]);
  assert.equal(second.code, 0, second.stderr);
  assert.equal(readFileSync(path.join(root, "etc/ssh/ssh_known_hosts.extra"), "utf8"), "");
});

test("agents image installs and invokes the ssh setup script", () => {
  const dockerfile = readFileSync(
    fileURLToPath(new URL("docker/Dockerfile.agents", repoRoot)),
    "utf8",
  );
  assert.match(dockerfile, /COPY agents\/rootfs\/ \//);
  assert.match(dockerfile, /paseo-agents-ssh-setup/);
});

// Normalised: this repo checks out CRLF on Windows, and the drift check
// below compares these two files line by line.
const baseCompose = readFileSync(
  fileURLToPath(new URL("docker/docker-compose.yml", repoRoot)),
  "utf8",
).replace(/\r\n/g, "\n");

test("every env var the ssh setup script reads reaches paseo through the base compose file", () => {
  // Compose only injects a variable into a container if the service's own
  // environment: block names it — .env alone does not reach the process. The
  // overlay cannot carry these: it is forbidden from touching the paseo
  // service, so the base file is the only place they can be wired through.
  const sshSetupScript = readFileSync(sshSetupPath, "utf8");
  const readVars = [
    ...new Set(
      [...sshSetupScript.matchAll(/\$\{([A-Z][A-Z0-9_]*)(?::[-=?][^}]*)?\}/g)].map((m) => m[1]),
    ),
  ];
  assert.ok(readVars.length > 0, "expected the script to read at least one variable");

  const paseoService = serviceBlocks(baseCompose).get("paseo").join("\n");
  const missing = readVars.filter((name) => !new RegExp(`^\\s*${name}:`, "m").test(paseoService));
  assert.deepEqual(
    missing,
    [],
    `not passed through to paseo's environment in docker-compose.yml: ${missing.join(", ")}`,
  );
});

// Mirrors the ssh-setup guard above: derive the variables a script reads from
// the environment by scanning for `$NAME` and `${NAME...}`, then drop the
// PASEO_VPN_* test seams (deliberately not wired in compose) and any names
// that are local, script-only computation rather than something read from
// the environment.
function envVarsReadBy(source, localNames = []) {
  return [
    ...new Set(
      [...source.matchAll(/\$\{?([A-Z][A-Z0-9_]*)/g)]
        .map((m) => m[1])
        .filter((name) => !name.startsWith("PASEO_VPN_") && !localNames.includes(name)),
    ),
  ];
}

test("every env var the gateway scripts read reaches the vpn service", () => {
  // paseo-vpn-validate computes these locally (CIDR_NET, CIDR_LEN) or
  // declares them as constants (RFC1918, MIN_PREFIX); none is read from the
  // environment.
  const validateLocals = ["CIDR_NET", "CIDR_LEN", "RFC1918", "MIN_PREFIX"];
  // Derived from the tree, not listed by hand: a hardcoded list silently fails
  // to cover a script added later, which is how VPN_CA_CERT_B64 reached the
  // image and the docs while never being passed to the container.
  // paseo-vpn-route is excluded because it runs in the sidecars, which the
  // next test covers separately.
  const gatewayScripts = execFileSync("git", ["ls-files", "docker/vpn/rootfs"], {
    encoding: "utf8",
    cwd: fileURLToPath(repoRoot),
  })
    .split("\n")
    .filter(Boolean)
    .filter((p) => !p.endsWith("paseo-vpn-route"))
    .map((p) => readFileSync(fileURLToPath(new URL(p, repoRoot)), "utf8"));
  const readVars = [
    ...new Set(gatewayScripts.flatMap((source) => envVarsReadBy(source, validateLocals))),
  ];
  assert.ok(readVars.length > 0, "expected the gateway scripts to read at least one variable");

  const vpnService = serviceBlocks(vpnStack).get("vpn").join("\n");
  const missing = readVars.filter((name) => !new RegExp(`^\\s*${name}:`, "m").test(vpnService));
  assert.deepEqual(
    missing,
    [],
    `not passed through to the vpn service in docker-compose.vpn.yml: ${missing.join(", ")}`,
  );
});

test("every env var the sidecar script reads reaches both route sidecars", () => {
  const readVars = envVarsReadBy(readFileSync(routePath, "utf8"));
  assert.ok(readVars.length > 0, "expected the sidecar script to read at least one variable");

  const services = serviceBlocks(vpnStack);
  for (const name of ["paseo-vpn-route", "browser-vpn-route"]) {
    const block = services.get(name).join("\n");
    const missing = readVars.filter((v) => !new RegExp(`^\\s*${v}:`, "m").test(block));
    assert.deepEqual(missing, [], `not passed through to ${name}: ${missing.join(", ")}`);
  }
});

const envExample = readFileSync(fileURLToPath(new URL("docker/.env.example", repoRoot)), "utf8");

test("every VPN stack variable is documented in .env.example", () => {
  const referenced = new Set(
    [...vpnStack.matchAll(/\$\{([A-Z0-9_]+)(?::[-?][^}]*)?\}/g)].map((m) => m[1]),
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
      !address.startsWith("10.") &&
      !address.startsWith("192.168.") &&
      !/^172\.(1[6-9]|2\d|3[01])\./.test(address) &&
      // Not VPN-related: BIND_ADDRESS's wildcard default and the reverse-proxy
      // note above it. Reserved special-use sentinels, not real addresses.
      address !== "0.0.0.0" &&
      !address.startsWith("127."),
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

// Every image built by docker.yml declares a build context, and each Dockerfile
// copies paths relative to that context. The two are set in different files, so
// they drift silently: `Dockerfile.agents` copied `agents/rootfs/`, correct for
// the context docker/README.md documents but wrong for the one CI used, and the
// release publish failed with "/agents/rootfs: not found". Nothing caught it
// because no test crossed from the workflow into the Dockerfile.
test("every Dockerfile's COPY sources resolve under the build context CI gives it", () => {
  const workflow = readFileSync(
    fileURLToPath(new URL(".github/workflows/docker.yml", repoRoot)),
    "utf8",
  ).split("\n");

  const pairs = [];
  for (let i = 0; i < workflow.length; i += 1) {
    const context = /^\s+context:\s*(\S+)\s*$/.exec(workflow[i]);
    if (!context) continue;
    for (let j = i + 1; j < Math.min(i + 6, workflow.length); j += 1) {
      const file = /^\s+file:\s*(\S+)\s*$/.exec(workflow[j]);
      if (file) {
        pairs.push({ context: context[1], dockerfile: file[1] });
        break;
      }
    }
  }
  assert.ok(pairs.length > 0, "found no context/file pairs in docker.yml");

  for (const { context, dockerfile } of pairs) {
    const contents = readFileSync(fileURLToPath(new URL(dockerfile, repoRoot)), "utf8");
    for (const line of contents.split("\n")) {
      const copy = /^COPY\s+(?!--from=)(?:--\S+\s+)*(\S+)\s+\S+\s*$/.exec(line.trim());
      if (!copy) continue;
      const source = copy[1];
      const resolved = fileURLToPath(
        new URL(path.posix.join(context === "." ? "" : context, source), repoRoot),
      );
      assert.ok(
        existsSync(resolved),
        `${dockerfile} copies "${source}" but with context "${context}" that resolves to ` +
          `${resolved}, which does not exist`,
      );
    }
  }
});

const caPath = fileURLToPath(new URL("docker/vpn/rootfs/usr/local/bin/paseo-vpn-ca", repoRoot));

const PEM = ["-----BEGIN CERTIFICATE-----", "MIIBkTCB+w==", "-----END CERTIFICATE-----"].join("\n");

test("CA installer writes a base64 certificate into the trust anchors", () => {
  const root = mkdtempSync(path.join(tmpdir(), "paseo-ca-"));
  const result = runScript(caPath, { VPN_CA_CERT_B64: Buffer.from(PEM).toString("base64") }, [
    "--root",
    root,
  ]);
  assert.equal(result.code, 0, result.stderr);
  const written = readFileSync(
    path.join(root, "usr/local/share/ca-certificates/paseo-vpn-extra.crt"),
    "utf8",
  );
  assert.match(written, /BEGIN CERTIFICATE/);
});

test("CA installer does nothing when no certificate is supplied", () => {
  const root = mkdtempSync(path.join(tmpdir(), "paseo-ca-"));
  const result = runScript(caPath, { VPN_CA_CERT_B64: "" }, ["--root", root]);
  assert.equal(result.code, 0, result.stderr);
  assert.ok(!existsSync(path.join(root, "usr/local/share/ca-certificates/paseo-vpn-extra.crt")));
});

test("CA installer refuses a value that is not a PEM certificate", () => {
  // A truncated or wrong-format value would otherwise install silently and the
  // tunnel would keep failing with nothing reporting why.
  const root = mkdtempSync(path.join(tmpdir(), "paseo-ca-"));
  const result = runScript(
    caPath,
    { VPN_CA_CERT_B64: Buffer.from("not a cert").toString("base64") },
    ["--root", root],
  );
  assert.equal(result.code, 1);
  assert.match(result.stderr, /not a PEM certificate/);
  assert.ok(!existsSync(path.join(root, "usr/local/share/ca-certificates/paseo-vpn-extra.crt")));
});

test("the gateway entrypoint installs the CA before starting the client", () => {
  const entrypoint = readFileSync(
    fileURLToPath(new URL("docker/vpn/rootfs/usr/local/bin/paseo-vpn-entrypoint", repoRoot)),
    "utf8",
  );
  const caCall = entrypoint.indexOf("paseo-vpn-ca");
  const client = entrypoint.indexOf("openfortivpn");
  assert.ok(caCall > 0, "entrypoint never installs the CA");
  assert.ok(caCall < client, "the CA must be installed before the client connects");
});

test("the image makes every rootfs script executable", () => {
  // run-parts skips non-executable files and ENTRYPOINT cannot exec one, and
  // the scripts are tracked 100644.
  const dockerfile = readFileSync(
    fileURLToPath(new URL("docker/Dockerfile.vpn", repoRoot)),
    "utf8",
  );
  const shipped = execFileSync("git", ["ls-files", "docker/vpn/rootfs"], {
    encoding: "utf8",
    cwd: fileURLToPath(repoRoot),
  })
    .split("\n")
    .filter(Boolean)
    .map((p) => p.replace("docker/vpn/rootfs", ""));
  for (const script of shipped) {
    assert.ok(dockerfile.includes(script), `Dockerfile.vpn never chmods ${script}`);
  }
});
