import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
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
