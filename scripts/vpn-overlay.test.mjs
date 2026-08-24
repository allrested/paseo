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
  writeFileSync(
    envFile,
    `INTERNAL_CIDRS='10.4.0.0/16\ntouch ${markerPath}'\n`,
  );

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
    assert.match(block, /paseo-vpn-route",\s*"--check"/);
  }
});

test("sidecars target the gateway by container name, not service name", () => {
  const services = serviceBlocks(overlay);
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
  const hostLine = config.split("\n").findIndex((line) => /^Host /.test(line));
  const identitiesOnly = config.split("\n").findIndex((line) => /IdentitiesOnly/.test(line));
  // Applied globally, IdentitiesOnly breaks GitHub authentication.
  assert.ok(hostLine >= 0 && identitiesOnly > hostLine);
});

test("ssh setup does nothing without INTERNAL_SSH_HOST", () => {
  const { code, root, stderr } = runSshSetup({ INTERNAL_SSH_HOST: "" });
  assert.equal(code, 0, stderr);
  assert.ok(!existsSync(path.join(root, "etc/ssh/ssh_config.d/10-internal.conf")));
});

test("agents image installs and invokes the ssh setup script", () => {
  const dockerfile = readFileSync(fileURLToPath(new URL("docker/Dockerfile.agents", repoRoot)), "utf8");
  assert.match(dockerfile, /COPY agents\/rootfs\/ \//);
  assert.match(dockerfile, /paseo-agents-ssh-setup/);
});
