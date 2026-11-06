import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
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
    "paseo-postman-cdp",
    "paseo-vpn-route",
    "postman-cdp",
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
  for (const name of [
    "paseo",
    "browser",
    "browser-cdp",
    "paseo-cdp",
    "postman-cdp",
    "paseo-postman-cdp",
  ]) {
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

test("agents entrypoint drops empty GIT_* vars but keeps configured ones", () => {
  // The stack files define these as empty strings when unset, and git rejects
  // an empty ident outright instead of falling back to config.
  const dockerfile = readFileSync(
    fileURLToPath(new URL("docker/Dockerfile.agents", repoRoot)),
    "utf8",
  );
  const entry = dockerfile.match(/<<'ENTRY'\n([\s\S]*?)\nENTRY\n/);
  assert.ok(entry, "could not find the generated agents entrypoint");
  const loop = entry[1].match(/for var in GIT_AUTHOR_NAME[\s\S]*?\nunset var value/);
  assert.ok(loop, "entrypoint never drops empty GIT_* vars");
  assert.ok(
    entry[1].indexOf(loop[0]) < entry[1].indexOf("exec /usr/local/bin/paseo-docker-entrypoint"),
    "the vars must be dropped before exec so descendants inherit it",
  );

  const dir = mkdtempSync(path.join(tmpdir(), "agents-ident-"));
  const script = path.join(dir, "probe.sh");
  writeFileSync(
    script,
    [
      loop[0],
      "printf 'GIT_AUTHOR_NAME=[%s]\\n' \"${GIT_AUTHOR_NAME-UNSET}\"",
      "printf 'GIT_AUTHOR_EMAIL=[%s]\\n' \"${GIT_AUTHOR_EMAIL-UNSET}\"",
      "printf 'GIT_COMMITTER_NAME=[%s]\\n' \"${GIT_COMMITTER_NAME-UNSET}\"",
      "",
    ].join("\n"),
  );
  const run = (env) =>
    spawnSync("sh", [script], { encoding: "utf8", env: { ...process.env, ...env } }).stdout;

  const emptied = run({
    GIT_AUTHOR_NAME: "",
    GIT_AUTHOR_EMAIL: "",
    GIT_COMMITTER_NAME: "",
  });
  assert.match(emptied, /GIT_AUTHOR_NAME=\[UNSET\]/);
  assert.match(emptied, /GIT_AUTHOR_EMAIL=\[UNSET\]/);
  assert.match(emptied, /GIT_COMMITTER_NAME=\[UNSET\]/);

  const configured = run({
    GIT_AUTHOR_NAME: "Someone",
    GIT_AUTHOR_EMAIL: "someone@example.com",
    GIT_COMMITTER_NAME: "Someone",
  });
  assert.match(configured, /GIT_AUTHOR_NAME=\[Someone\]/);
  assert.match(configured, /GIT_AUTHOR_EMAIL=\[someone@example\.com\]/);
  assert.match(configured, /GIT_COMMITTER_NAME=\[Someone\]/);
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
  // declares them as constants (RFC1918, MIN_PREFIX, SPECIAL_USE,
  // MIN_EXTERNAL_PREFIX); none is read from the environment.
  const validateLocals = [
    "CIDR_NET",
    "CIDR_LEN",
    "RFC1918",
    "MIN_PREFIX",
    "SPECIAL_USE",
    "MIN_EXTERNAL_PREFIX",
  ];
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

test("the gateway entrypoint requires the N_PPP line discipline", () => {
  // /dev/ppp satisfies the older check while ppp_async is unloaded, and pppd
  // then fails with EPERM on TIOCSETD instead of naming the missing module.
  const entrypoint = readFileSync(
    fileURLToPath(new URL("docker/vpn/rootfs/usr/local/bin/paseo-vpn-entrypoint", repoRoot)),
    "utf8",
  );
  const guard = entrypoint.indexOf("/proc/tty/ldiscs");
  const client = entrypoint.indexOf("openfortivpn");
  assert.ok(guard > 0, "entrypoint never checks for the N_PPP line discipline");
  assert.ok(guard < client, "the discipline must be checked before the client connects");
  assert.match(entrypoint, /modprobe ppp_async/);
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

test("validator accepts a public host in EXTERNAL_VIA_VPN", () => {
  const result = runValidate({
    ...LOCAL,
    INTERNAL_CIDRS: "10.4.0.0/16",
    EXTERNAL_VIA_VPN: "44.197.240.51/32",
  });
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /validated external 44\.197\.240\.51\/32/);
});

test("validator accepts several public hosts", () => {
  const result = runValidate({
    ...LOCAL,
    INTERNAL_CIDRS: "10.4.0.0/16",
    EXTERNAL_VIA_VPN: "44.197.240.51/32,203.0.113.0/24",
  });
  assert.equal(result.code, 0, result.stderr);
});

test("validator rejects a private range in EXTERNAL_VIA_VPN", () => {
  // It belongs in INTERNAL_CIDRS, where the curation guard covers it.
  const result = runValidate({
    ...LOCAL,
    INTERNAL_CIDRS: "10.4.0.0/16",
    EXTERNAL_VIA_VPN: "10.9.0.0/24",
  });
  assert.equal(result.code, 1);
  assert.match(result.stderr, /inside RFC 1918; declare private ranges in INTERNAL_CIDRS/);
});

test("validator rejects an external range broader than /24", () => {
  const result = runValidate({
    ...LOCAL,
    INTERNAL_CIDRS: "10.4.0.0/16",
    EXTERNAL_VIA_VPN: "44.197.0.0/16",
  });
  assert.equal(result.code, 1);
  assert.match(result.stderr, /broader than \/24/);
});

test("validator rejects a default route smuggled in via EXTERNAL_VIA_VPN", () => {
  const result = runValidate({
    ...LOCAL,
    INTERNAL_CIDRS: "10.4.0.0/16",
    EXTERNAL_VIA_VPN: "0.0.0.0/0",
  });
  assert.equal(result.code, 1);
  assert.match(result.stderr, /broader than \/24/);
});

test("validator rejects special-use ranges in EXTERNAL_VIA_VPN", () => {
  // 169.254.169.254 is the cloud metadata endpoint; routing it into a
  // corporate tunnel would be a credential-exposure bug, not a typo.
  for (const entry of ["127.0.0.1/32", "169.254.169.254/32", "224.0.0.1/32"]) {
    const result = runValidate({
      ...LOCAL,
      INTERNAL_CIDRS: "10.4.0.0/16",
      EXTERNAL_VIA_VPN: entry,
    });
    assert.equal(result.code, 1, `${entry} should be rejected`);
    assert.match(result.stderr, /overlaps the special-use range/);
  }
});

test("validator rejects an unaligned external entry", () => {
  const result = runValidate({
    ...LOCAL,
    INTERNAL_CIDRS: "10.4.0.0/16",
    EXTERNAL_VIA_VPN: "203.0.113.5/24",
  });
  assert.equal(result.code, 1);
  assert.match(result.stderr, /not aligned to its prefix/);
});

test("validator rejects a command smuggled into EXTERNAL_VIA_VPN", () => {
  const result = runValidate({
    ...LOCAL,
    INTERNAL_CIDRS: "10.4.0.0/16",
    EXTERNAL_VIA_VPN: "44.197.240.51/32; touch /tmp/pwned",
  });
  assert.equal(result.code, 1);
  assert.match(result.stderr, /outside the CIDR-list alphabet/);
});

test("validator leaves EXTERNAL_VIA_VPN optional", () => {
  const result = runValidate({ ...LOCAL, INTERNAL_CIDRS: "10.4.0.0/16" });
  assert.equal(result.code, 0, result.stderr);
  assert.doesNotMatch(result.stdout, /validated external/);
});

test("route hook sends declared public hosts out ppp0", () => {
  const result = runScript(ipUpPath, {
    PASEO_VPN_DRY_RUN: "1",
    INTERNAL_CIDRS: "10.4.0.0/16",
    EXTERNAL_VIA_VPN: "44.197.240.51/32",
  });
  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(result.stdout.trim().split("\n"), [
    "ip route replace 10.4.0.0/16 dev ppp0",
    "ip route replace 44.197.240.51/32 dev ppp0",
  ]);
  assert.doesNotMatch(result.stdout, /default/);
});

test("route sidecar installs and checks the public exceptions too", () => {
  const env = {
    ...DRY,
    INTERNAL_CIDRS: "10.4.0.0/16",
    EXTERNAL_VIA_VPN: "44.197.240.51/32",
  };
  const installed = runRoute(env);
  assert.equal(installed.code, 0, installed.stderr);
  assert.deepEqual(installed.stdout.trim().split("\n"), [
    "ip route replace 10.4.0.0/16 via 172.18.0.9",
    "ip route replace 44.197.240.51/32 via 172.18.0.9",
  ]);

  const checked = runRoute(env, ["--check"]);
  assert.equal(checked.code, 0, checked.stderr);
  assert.match(checked.stdout, /ip route show 44\.197\.240\.51\/32/);
});

test("the VPN stack passes EXTERNAL_VIA_VPN to the gateway and both sidecars", () => {
  // All three must agree: the gateway opens the firewall and routes out ppp0,
  // each sidecar installs the matching route in its own namespace.
  const services = serviceBlocks(vpnStack);
  for (const name of ["vpn", "paseo-vpn-route", "browser-vpn-route"]) {
    const block = services.get(name).join("\n");
    assert.match(
      block,
      /EXTERNAL_VIA_VPN: \$\{EXTERNAL_VIA_VPN:-\}/,
      `service "${name}" does not receive EXTERNAL_VIA_VPN`,
    );
  }
});

test("agents image hands the npm prefix to the runtime user", () => {
  // Installed as root, run as paseo (uid 1000): without this the Claude Code
  // updater has nowhere to write and the version is frozen to image rebuilds.
  const dockerfile = readFileSync(
    fileURLToPath(new URL("docker/Dockerfile.agents", repoRoot)),
    "utf8",
  );

  // Instructions, with line continuations folded back together.
  const instructions = dockerfile
    .replace(/\\\n/g, " ")
    .split("\n")
    .filter((line) => /^[A-Z]+ /.test(line));

  // The recursive chown MUST share the npm layer. In its own RUN it would
  // rewrite ~1.4GB of packages into a new layer for a metadata change.
  const npmRun = instructions.find((i) => i.includes("npm install -g"));
  assert.ok(npmRun, "no npm install -g instruction");
  assert.match(
    npmRun,
    /chown -R paseo:paseo \/usr\/local\/lib\/node_modules/,
    "the node_modules chown must be in the same RUN as the npm install, or it costs a 1.4GB layer",
  );

  // /usr/local/bin is a directory chown, never recursive: recursing would copy
  // the ~1.1GB of Kiro binaries into a new layer.
  const binChown = dockerfile.indexOf("chown paseo:paseo /usr/local/bin");
  assert.ok(binChown > 0, "/usr/local/bin is never handed to the runtime user");
  assert.doesNotMatch(dockerfile, /chown -R paseo:paseo \/usr\/local\/bin/);

  // ...and it must come last, after every root-owned install: npm, the Kiro
  // archive, and the rootfs copy. One added afterwards would land root-owned.
  for (const earlier of ["npm install -g", "Q_INSTALL_GLOBAL", "COPY agents/rootfs/ /"]) {
    assert.ok(
      binChown > dockerfile.indexOf(earlier),
      `the /usr/local/bin chown must come after "${earlier}"`,
    );
  }
});

// The shared browser. On 2026-10-01 its autostart Chromium exited, the one
// relaunched from the desktop menu came up without a debug port, the CDP
// healthcheck failed, and Traefik dropped the desktop's public route - the
// one place the browser could be relaunched from. Postman's CDP had never
// reached its fixed port at all. These tests hold each piece of the fix.
const browserFile = (file) => fileURLToPath(new URL(`docker/browser/rootfs/${file}`, repoRoot));
const browserDockerfile = readFileSync(
  fileURLToPath(new URL("docker/Dockerfile.browser", repoRoot)),
  "utf8",
).replace(/\r\n/g, "\n");

// A directory of stand-in commands, put first on PATH.
function stubDir(stubs) {
  const dir = mkdtempSync(path.join(tmpdir(), "paseo-stubs-"));
  for (const [name, body] of Object.entries(stubs)) {
    const file = path.join(dir, name);
    writeFileSync(file, `#!/bin/bash\n${body}\n`);
    chmodSync(file, 0o755);
  }
  return dir;
}

// Runs a session loop for a few seconds. `timeout` signals its whole process
// group, so background stubs die with it.
function runFor(seconds, scriptPath, env) {
  return spawnSync("timeout", [String(seconds), "bash", scriptPath], {
    encoding: "utf8",
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
}

const readLines = (file) =>
  existsSync(file) ? readFileSync(file, "utf8").split("\n").filter(Boolean) : [];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function until(check, ms = 10_000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (check()) return true;
    await sleep(100);
  }
  return check();
}

// Starts a loop that never exits on its own, checks that a second copy exits at
// once, and stops the first.
async function assertRunsOnce(scriptPath, env) {
  const first = spawn("timeout", ["8", "bash", scriptPath], {
    env: { ...process.env, ...env },
    stdio: "ignore",
  });
  const firstExit = once(first, "exit");
  try {
    await sleep(500);
    assert.equal(first.exitCode, null, "the first copy must hold the lock and keep running");
    const second = runFor(5, scriptPath, env);
    assert.equal(second.status, 0, "a second copy must exit at once, not run until the timeout");
  } finally {
    first.kill();
    await firstExit;
  }
}

// The healthcheck's `test:` value, which the formatter may spread over
// several lines.
const healthTest = (block) =>
  /\n\s+test:([\s\S]*?)\n\s+interval:/.exec(`\n${block.join("\n")}`)?.[1] ?? "";

test("the desktop's health never depends on CDP", () => {
  // CDP liveness stays visible on browser-cdp; the route follows the desktop.
  for (const [name, source] of [
    ["docker-compose.yml", baseCompose],
    ["docker-compose.vpn.yml", vpnStack],
  ]) {
    const services = serviceBlocks(source);
    const browserTest = healthTest(services.get("browser"));
    assert.match(browserTest, /127\.0\.0\.1:3000/, `${name}: browser health must probe nginx`);
    assert.match(browserTest, /127\.0\.0\.1:8082/, `${name}: browser health must probe Selkies`);
    assert.doesNotMatch(browserTest, /9222/, `${name}: browser health must not probe CDP`);
    // nginx answers 401 without credentials. -f would turn that into a failure
    // and take the route down on every password-protected stack.
    assert.doesNotMatch(
      browserTest,
      /\s-[a-zA-Z]*f|--fail/,
      `${name}: no -f on the desktop probes`,
    );
    // Docker kills only the shell on timeout, so each curl needs its own limit.
    assert.equal(browserTest.match(/ -m \d/g)?.length, 2, `${name}: both curls need -m`);
    const cdpTest = healthTest(services.get("browser-cdp"));
    assert.match(cdpTest, /127\.0\.0\.1:9222/, `${name}: browser-cdp must keep probing CDP`);
  }
});

test("every Chromium launch gets CHROME_CLI, not only the autostart one", () => {
  const dropIn = browserFile("etc/chromium.d/zz-paseo-cdp");
  const flagsAfterSourcing = (env) =>
    spawnSync(
      "sh",
      ["-c", 'CHROMIUM_FLAGS="--from-debian"; . "$0"; printf %s "$CHROMIUM_FLAGS"', dropIn],
      { encoding: "utf8", env: { PATH: process.env.PATH, ...env } },
    );
  const set = flagsAfterSourcing({
    CHROME_CLI: "--remote-debugging-port=9222 --remote-allow-origins=*",
  });
  assert.equal(set.status, 0, set.stderr);
  assert.equal(set.stdout, "--from-debian --remote-debugging-port=9222 --remote-allow-origins=*");
  const unset = flagsAfterSourcing({});
  assert.equal(unset.stdout, "--from-debian");
});

const holderPath = browserFile("usr/local/bin/profile-holder");
const HOST = "browserhost";

function runHolder(profile, name) {
  const result = spawnSync("bash", [holderPath, profile, name], {
    encoding: "utf8",
    env: { ...process.env, HOSTNAME: HOST },
  });
  return { code: result.status, stdout: result.stdout.trim() };
}

function profileLockedBy(target) {
  const profile = mkdtempSync(path.join(tmpdir(), "paseo-profile-"));
  if (target) symlinkSync(target, path.join(profile, "SingletonLock"));
  return profile;
}

// /proc/<pid>/comm comes from the executable's file name, so a copy of sleep
// named "chromium" stands in for the browser.
function processNamed(name) {
  const exe = path.join(mkdtempSync(path.join(tmpdir(), "paseo-proc-")), name);
  const sleepBinary = execFileSync("bash", ["-c", 'readlink -f "$(command -v sleep)"'], {
    encoding: "utf8",
  }).trim();
  copyFileSync(sleepBinary, exe);
  chmodSync(exe, 0o755);
  return spawn(exe, ["60"], { stdio: "ignore" });
}

test("profile-holder reports a live holder on this host", async () => {
  const browser = processNamed("chromium");
  try {
    const result = runHolder(profileLockedBy(`${HOST}-${browser.pid}`), "chromium");
    assert.deepEqual(result, { code: 0, stdout: String(browser.pid) });
  } finally {
    browser.kill();
    await once(browser, "exit");
  }
});

test("profile-holder treats a lock from an earlier container as stale", async () => {
  // A recreated container gets a new hostname; the old lock must not block it.
  const browser = processNamed("chromium");
  try {
    assert.equal(runHolder(profileLockedBy(`oldcontainer-${browser.pid}`), "chromium").code, 1);
  } finally {
    browser.kill();
    await once(browser, "exit");
  }
});

test("profile-holder treats a lock from an exited process as stale", async () => {
  const browser = processNamed("chromium");
  browser.kill();
  await once(browser, "exit");
  assert.equal(runHolder(profileLockedBy(`${HOST}-${browser.pid}`), "chromium").code, 1);
});

test("profile-holder treats a PID reused by another program as stale", () => {
  // This test runner is alive, but it is not Chromium.
  assert.equal(runHolder(profileLockedBy(`${HOST}-${process.pid}`), "chromium").code, 1);
});

test("profile-holder reports nothing when the profile has no lock", () => {
  assert.equal(runHolder(profileLockedBy(null), "chromium").code, 1);
});

// The stale lock is a dangling symlink, which existsSync() reports as absent.
const lockPresent = (profile) =>
  lstatSync(path.join(profile, "SingletonLock"), { throwIfNoEntry: false }) !== undefined;

const chromiumSessionPath = browserFile("usr/local/bin/chromium-session");

function chromiumSessionFixture(held) {
  const home = mkdtempSync(path.join(tmpdir(), "paseo-home-"));
  const profile = path.join(home, ".config/chromium");
  mkdirSync(profile, { recursive: true });
  symlinkSync("oldcontainer-12", path.join(profile, "SingletonLock"));
  const log = path.join(home, "launches.log");
  const holderLog = path.join(home, "holder.log");
  const stubs = stubDir({
    "profile-holder": `echo "$*" >> "${holderLog}"\n${held ? "echo 42" : "exit 1"}`,
    // One line per argument, so two flags and one quoted string differ.
    "wrapped-chromium": `printf '%s\\n' "$@" >> "${log}"\necho --- >> "${log}"`,
  });
  const env = {
    HOME: home,
    TMPDIR: home,
    PATH: `${stubs}:${process.env.PATH}`,
    CHROME_CLI: "--remote-debugging-port=9222 --remote-allow-origins=*",
  };
  return { env, log, holderLog, home, profile };
}

test("chromium-session relaunches Chromium, with CHROME_CLI as separate flags, after it exits", () => {
  const { env, log, holderLog, profile } = chromiumSessionFixture(false);
  runFor(7, chromiumSessionPath, env);
  const launches = existsSync(log) ? readFileSync(log, "utf8").split("---\n").filter(Boolean) : [];
  assert.ok(launches.length >= 2, `expected a relaunch, saw ${launches.length} launch(es)`);
  for (const launch of launches) {
    assert.deepEqual(launch.split("\n").filter(Boolean), [
      "--remote-debugging-port=9222",
      "--remote-allow-origins=*",
    ]);
  }
  assert.ok(!lockPresent(profile), "a stale lock must be cleared before launching");
  assert.equal(readLines(holderLog)[0], `${profile} chromium`);
});

test("chromium-session waits while another Chromium holds the profile", () => {
  // Launching would only hand a new window to that Chromium, every 5 seconds.
  const { env, log, holderLog, profile } = chromiumSessionFixture(true);
  runFor(3, chromiumSessionPath, env);
  assert.deepEqual(readLines(log), []);
  assert.ok(lockPresent(profile), "a live holder's lock must be left alone");
  assert.equal(readLines(holderLog)[0], `${profile} chromium`);
});

test("chromium-session runs once per container", async () => {
  await assertRunsOnce(chromiumSessionPath, chromiumSessionFixture(true).env);
});

test("a Chromium that outlives its chromium-session does not keep the loop's lock", async () => {
  // Otherwise the next loop exits at once and nothing relaunches Chromium.
  const { env, home } = chromiumSessionFixture(false);
  const pidFile = path.join(home, "browser.pid");
  const stubs = stubDir({
    "profile-holder": "exit 1",
    "wrapped-chromium": `echo $$ > "${pidFile}"\nexec sleep 30`,
  });
  const loop = spawn("bash", [chromiumSessionPath], {
    env: { ...process.env, ...env, PATH: `${stubs}:${process.env.PATH}` },
    stdio: "ignore",
  });
  const loopExit = once(loop, "exit");
  let browserPid;
  try {
    assert.ok(await until(() => existsSync(pidFile)), "the loop never launched Chromium");
    browserPid = Number(readFileSync(pidFile, "utf8"));
    loop.kill("SIGKILL");
    await loopExit;
    const probe = spawnSync("flock", ["-n", path.join(home, "chromium-session.lock"), "true"]);
    assert.equal(probe.status, 0, "the lock must be free once the loop is gone");
  } finally {
    if (browserPid) process.kill(browserPid);
  }
});

const postmanSessionPath = browserFile("usr/local/bin/postman-session");

function postmanSessionFixture({ held = false } = {}) {
  const home = mkdtempSync(path.join(tmpdir(), "paseo-home-"));
  const profile = path.join(home, ".config/Postman");
  mkdirSync(profile, { recursive: true });
  symlinkSync("oldcontainer-12", path.join(profile, "SingletonLock"));
  const log = path.join(home, "launches.log");
  const stubs = stubDir({
    "profile-holder": `echo "holder $*" >> "${log}"\n${held ? "echo 42" : "exit 1"}`,
    "wrapped-postman": `echo postman >> "${log}"`,
    "postman-cdp-bridge": `echo bridge >> "${log}"
trap 'echo bridge-stopped >> "${log}"; exit 0' TERM
sleep 30 & wait`,
  });
  return {
    profile,
    log,
    env: { HOME: home, TMPDIR: home, PATH: `${stubs}:${process.env.PATH}` },
  };
}

test("postman-session starts the CDP bridge and relaunches Postman", () => {
  const { env, log, profile } = postmanSessionFixture();
  runFor(7, postmanSessionPath, env);
  const lines = readLines(log);
  assert.equal(lines.filter((line) => line === "bridge").length, 1);
  assert.ok(lines.filter((line) => line === "postman").length >= 2, `saw: ${lines.join(",")}`);
  assert.ok(lines.includes(`holder ${profile} postman`), `saw: ${lines.join(",")}`);
  assert.ok(!lockPresent(profile), "a stale lock must be cleared before launching");
});

test("postman-session waits while another Postman holds the profile", () => {
  const { env, log, profile } = postmanSessionFixture({ held: true });
  runFor(3, postmanSessionPath, env);
  assert.ok(!readLines(log).includes("postman"), "a held profile must not be launched again");
  assert.ok(lockPresent(profile), "a live holder's lock must be left alone");
});

test("postman-session runs once per container", async () => {
  await assertRunsOnce(postmanSessionPath, postmanSessionFixture({ held: true }).env);
});

test("postman-session stops its bridge when it stops", async () => {
  // A bridge left behind would keep the fixed port while the next loop's bridge
  // fails to bind it.
  const { env, log } = postmanSessionFixture({ held: true });
  const loop = spawn("bash", [postmanSessionPath], {
    env: { ...process.env, ...env },
    stdio: "ignore",
  });
  const loopExit = once(loop, "exit");
  try {
    assert.ok(await until(() => readLines(log).includes("bridge")), "the bridge never started");
    loop.kill("SIGTERM");
    await loopExit;
    assert.ok(
      await until(() => readLines(log).includes("bridge-stopped")),
      "the bridge was left running",
    );
  } finally {
    loop.kill("SIGKILL");
  }
});

test("postman-session does nothing when POSTMAN_AUTOSTART is off", () => {
  // A fresh volume's autostart always carries the line, so the flag is
  // honoured here as well as when the line is written.
  const { env, log } = postmanSessionFixture();
  const result = runFor(5, postmanSessionPath, { ...env, POSTMAN_AUTOSTART: "false" });
  assert.equal(result.status, 0);
  assert.deepEqual(readLines(log), []);
});

const bridgePath = browserFile("usr/local/bin/postman-cdp-bridge");
const RELAY = "TCP-LISTEN:9225,bind=127.0.0.1,fork,reuseaddr TCP:127.0.0.1:";

// A fake world for the bridge: who holds the profile, which loopback ports each
// process listens on, and which ports answer as DevTools servers.
function bridgeWorld({ socatExitsAtOnce = false } = {}) {
  const home = mkdtempSync(path.join(tmpdir(), "paseo-home-"));
  const state = path.join(home, "state");
  mkdirSync(state);
  const log = path.join(home, "socat.log");
  const stubs = stubDir({
    "profile-holder": `cat "${state}/holder" 2>/dev/null || exit 1`,
    ss: `cat "${state}/ss" 2>/dev/null`,
    curl: `url="\${@: -1}"; port="\${url#http://127.0.0.1:}"; port="\${port%%/*}"
grep -qx "$port" "${state}/alive" 2>/dev/null`,
    socat: socatExitsAtOnce
      ? `echo "start $*" >> "${log}"`
      : `echo "start $*" >> "${log}"
trap 'echo "stop $*" >> "${log}"; exit 0' TERM
sleep 30 & wait`,
  });
  const set = (files) => {
    for (const [name, content] of Object.entries(files)) {
      writeFileSync(path.join(state, name), content);
    }
  };
  return {
    home,
    log,
    set,
    env: {
      HOME: home,
      TMPDIR: home,
      POSTMAN_CDP_PORT: "9225",
      PATH: `${stubs}:${process.env.PATH}`,
    },
  };
}

// The shape of `ss -Hltnp src 127.0.0.1` output.
const ssLine = (port, pid) =>
  `LISTEN 0      511        127.0.0.1:${port}       0.0.0.0:*    users:(("postman",pid=${pid},fd=40))\n`;

const starts = (log) => readLines(log).filter((line) => line.startsWith("start "));

test("postman-cdp-bridge republishes the profile holder's DevTools port", () => {
  const world = bridgeWorld();
  world.set({ holder: "111\n", ss: ssLine(41234, 111), alive: "41234\n" });
  runFor(3, bridgePath, world.env);
  assert.deepEqual(starts(world.log), [`start ${RELAY}41234`]);
});

test("postman-cdp-bridge ignores the port of a second Postman launch", () => {
  // The menu or the postman:// sign-in hand-off starts a second Postman, which
  // binds a port of its own and rewrites DevToolsActivePort before it exits.
  const world = bridgeWorld();
  mkdirSync(path.join(world.home, ".config/Postman"), { recursive: true });
  writeFileSync(
    path.join(world.home, ".config/Postman/DevToolsActivePort"),
    "50000\n/devtools/browser/x\n",
  );
  world.set({
    holder: "111\n",
    ss: ssLine(50000, 222) + ssLine(41234, 111),
    alive: "50000\n41234\n",
  });
  runFor(3, bridgePath, world.env);
  assert.deepEqual(starts(world.log), [`start ${RELAY}41234`]);
});

test("postman-cdp-bridge follows Postman to its new port after a restart", async () => {
  const world = bridgeWorld();
  world.set({ holder: "111\n", ss: ssLine(41234, 111), alive: "41234\n" });
  const bridge = spawn("timeout", ["12", "bash", bridgePath], {
    env: { ...process.env, ...world.env },
    stdio: "ignore",
  });
  const bridgeExit = once(bridge, "exit");
  try {
    assert.ok(await until(() => starts(world.log).length === 1), "no first relay");
    world.set({ holder: "333\n", ss: ssLine(41999, 333), alive: "41999\n" });
    assert.ok(
      await until(() => starts(world.log).includes(`start ${RELAY}41999`)),
      "the relay never followed Postman",
    );
  } finally {
    bridge.kill();
    await bridgeExit;
  }
  const lines = readLines(world.log);
  assert.ok(
    lines.indexOf(`stop ${RELAY}41234`) >= 0 &&
      lines.indexOf(`stop ${RELAY}41234`) < lines.indexOf(`start ${RELAY}41999`),
    `the old relay must stop before the new one starts: ${lines.join(" | ")}`,
  );
});

test("postman-cdp-bridge restarts a relay that died", () => {
  const world = bridgeWorld({ socatExitsAtOnce: true });
  world.set({ holder: "111\n", ss: ssLine(41234, 111), alive: "41234\n" });
  runFor(7, bridgePath, world.env);
  const seen = starts(world.log);
  assert.ok(seen.length >= 2, `saw ${seen.length} start(s)`);
  assert.ok(
    seen.every((line) => line === `start ${RELAY}41234`),
    seen.join(" | "),
  );
});

test("postman-cdp-bridge stays out of the way when Postman holds the fixed port itself", () => {
  const world = bridgeWorld();
  world.set({ holder: "111\n", ss: ssLine(9225, 111), alive: "9225\n" });
  runFor(3, bridgePath, world.env);
  assert.deepEqual(readLines(world.log), []);
});

test("postman-cdp-bridge waits while no Postman holds the profile", () => {
  const world = bridgeWorld();
  world.set({ ss: ssLine(41234, 111), alive: "41234\n" });
  runFor(3, bridgePath, world.env);
  assert.deepEqual(readLines(world.log), []);
});

test("postman-cdp-bridge's relay dies with it", async () => {
  // An orphaned relay would hold the fixed port, forwarding to a dead one.
  const world = bridgeWorld();
  world.set({ holder: "111\n", ss: ssLine(41234, 111), alive: "41234\n" });
  const bridge = spawn("bash", [bridgePath], {
    env: { ...process.env, ...world.env },
    stdio: "ignore",
  });
  const bridgeExit = once(bridge, "exit");
  try {
    assert.ok(await until(() => starts(world.log).length === 1), "no relay started");
    bridge.kill("SIGTERM");
    await bridgeExit;
    assert.ok(
      await until(() => readLines(world.log).includes(`stop ${RELAY}41234`)),
      "the relay outlived the bridge",
    );
  } finally {
    bridge.kill("SIGKILL");
  }
});

test("postman-cdp-bridge runs once per container", async () => {
  await assertRunsOnce(bridgePath, bridgeWorld().env);
});

const desktopSessionPath = browserFile("custom-cont-init.d/30-desktop-session");

function desktopFixture(autostart, mode = 0o644) {
  const home = mkdtempSync(path.join(tmpdir(), "paseo-home-"));
  const conf = path.join(home, ".config/labwc");
  mkdirSync(conf, { recursive: true });
  writeFileSync(path.join(conf, "autostart"), autostart);
  chmodSync(path.join(conf, "autostart"), mode);
  writeFileSync(
    path.join(conf, "menu.xml"),
    '<openbox_menu><menu id="root">\n</menu></openbox_menu>\n',
  );
  return { home, conf };
}

function runDesktopSession(home, env = {}) {
  return spawnSync("bash", [desktopSessionPath], {
    encoding: "utf8",
    env: { ...process.env, HOME: home, PIXELFLUX_WAYLAND: "true", ...env },
  });
}

// The rewritten browser line keeps the original launch as its fallback.
const sessionLine = (original) =>
  `if [ -x /usr/local/bin/chromium-session ]; then /usr/local/bin/chromium-session; else ${original}; fi`;

// Live autostart files in the deployed volumes predate the current base image
// and carry its old Wayland flags.
const DEPLOYED_LAUNCH =
  "wrapped-chromium --enable-features=UseOzonePlatform --ozone-platform=wayland ${CHROME_CLI}";
const DEPLOYED_AUTOSTART = [
  "#!/bin/bash",
  "/usr/local/bin/postman-session &",
  DEPLOYED_LAUNCH,
  "",
].join("\n");

test("existing volumes get the Chromium session loop", () => {
  const { home, conf } = desktopFixture(DEPLOYED_AUTOSTART);
  const result = runDesktopSession(home);
  assert.equal(result.status, 0, result.stderr);
  const autostart = path.join(conf, "autostart");
  assert.deepEqual(readFileSync(autostart, "utf8").split("\n"), [
    "#!/bin/bash",
    "/usr/local/bin/postman-session &",
    sessionLine(DEPLOYED_LAUNCH),
    "",
  ]);
  // labwc runs the file with sh.
  const parse = spawnSync("sh", ["-n", autostart], { encoding: "utf8" });
  assert.equal(parse.status, 0, parse.stderr);
});

test("the desktop init script is idempotent and adds Postman's loop once", () => {
  // The old guard grepped for a string it never inserted, so every container
  // start added another Postman loop.
  const { home, conf } = desktopFixture("#!/bin/bash\nwrapped-chromium ${CHROME_CLI}\n");
  runDesktopSession(home);
  const afterFirstRun = readFileSync(path.join(conf, "autostart"), "utf8");
  runDesktopSession(home);
  runDesktopSession(home);
  assert.equal(readFileSync(path.join(conf, "autostart"), "utf8"), afterFirstRun);
  assert.deepEqual(afterFirstRun.split("\n"), [
    "#!/bin/bash",
    "/usr/local/bin/postman-session &",
    sessionLine("wrapped-chromium ${CHROME_CLI}"),
    "",
  ]);
  const menu = readFileSync(path.join(conf, "menu.xml"), "utf8");
  assert.equal(menu.split("wrapped-postman").length - 1, 1, "one Postman menu entry");
});

test("the desktop init script adds no Postman loop when POSTMAN_AUTOSTART is off", () => {
  const { home, conf } = desktopFixture("#!/bin/bash\nwrapped-chromium ${CHROME_CLI}\n");
  runDesktopSession(home, { POSTMAN_AUTOSTART: "false" });
  assert.deepEqual(readFileSync(path.join(conf, "autostart"), "utf8").split("\n"), [
    "#!/bin/bash",
    sessionLine("wrapped-chromium ${CHROME_CLI}"),
    "",
  ]);
});

test("the desktop init script keeps a locked-down autostart locked down", () => {
  // The base image sets 550 when RESTART_APP is on; the edit must not undo it.
  const { home, conf } = desktopFixture(DEPLOYED_AUTOSTART, 0o550);
  runDesktopSession(home);
  const autostart = path.join(conf, "autostart");
  assert.equal(statSync(autostart).mode & 0o777, 0o550);
  assert.match(readFileSync(autostart, "utf8"), /then \/usr\/local\/bin\/chromium-session; else/);
});

test("an older image on the same volume still starts Chromium", (t) => {
  // The volume outlives the image. An image without chromium-session must fall
  // back to the original launch, or nothing starts the browser.
  if (existsSync("/usr/local/bin/chromium-session")) {
    t.skip("this machine has /usr/local/bin/chromium-session");
    return;
  }
  const { home, conf } = desktopFixture(DEPLOYED_AUTOSTART);
  runDesktopSession(home);
  const log = path.join(home, "launches.log");
  const stubs = stubDir({ "wrapped-chromium": `echo "$*" >> "${log}"` });
  spawnSync("sh", [path.join(conf, "autostart")], {
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${stubs}:${process.env.PATH}`,
      CHROME_CLI: "--remote-debugging-port=9222",
    },
  });
  assert.deepEqual(readLines(log), [
    "--enable-features=UseOzonePlatform --ozone-platform=wayland --remote-debugging-port=9222",
  ]);
});

test("fresh and existing volumes get the same Chromium session line", () => {
  const fromDockerfile = /chromium_line='([^']+)'/.exec(browserDockerfile)?.[1];
  const fromInit = /^CHROMIUM_LINE='([^']+)'$/m.exec(readFileSync(desktopSessionPath, "utf8"))?.[1];
  assert.ok(fromDockerfile, "Dockerfile.browser defines no chromium_line");
  assert.equal(fromDockerfile, fromInit);
  assert.match(browserDockerfile, /s\|\^wrapped-chromium\.\*\|\$\{chromium_line\}\|/);
});

test("the image installs socat for the Postman CDP bridge", () => {
  assert.match(browserDockerfile, /apt-get install[^\n]*\bsocat\b/);
});

test("the image installs libsecret, without which signed-in Postman cannot send", () => {
  // Postman's request runtime loads keytar, which links libsecret-1.so.0, when
  // it starts. The lightweight client does not, so it hides the gap.
  assert.match(browserDockerfile, /apt-get install[^\n]*\blibsecret-1-0\b/);
});

test("every browser rootfs script is CRLF-stripped and syntax-checked in the build", () => {
  // A script missing from the loop ships unchecked; with CRLF line endings its
  // shebang fails and the container dies with exit 127.
  const loop = /for script in \\\n([\s\S]*?); \\\n\s+do/.exec(browserDockerfile)?.[1] ?? "";
  for (const dir of ["usr/local/bin", "custom-cont-init.d"]) {
    for (const name of readdirSync(browserFile(dir))) {
      assert.ok(
        loop.includes(`/${dir}/${name}`),
        `/${dir}/${name} is not in the Dockerfile's script loop`,
      );
    }
  }
  assert.match(browserDockerfile, /sh -n \/etc\/chromium\.d\/zz-paseo-cdp/);
});

test("Postman's sign-in callback has a handler that receives the URL", () => {
  // Postman registers exactly "Postman.desktop" for postman:// via xdg-mime.
  const entry = readFileSync(browserFile("usr/share/applications/Postman.desktop"), "utf8");
  assert.match(entry, /^MimeType=x-scheme-handler\/postman;$/m);
  assert.match(entry, /^Exec=\/usr\/local\/bin\/wrapped-postman %U$/m);
  // /opt/Postman/Postman re-joins arguments for system(), cutting the callback
  // at its first '&'; the launcher must exec the Electron binary itself and
  // pass the URL on.
  const launcher = readFileSync(browserFile("usr/local/bin/wrapped-postman"), "utf8");
  assert.match(launcher, /^BIN=\/opt\/Postman\/app\/postman$/m);
  assert.match(launcher, /^exec \$\{BIN\}[\s\S]*?"\$@"/m);
});
