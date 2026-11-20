// The fork's APK workflow tests use Node built-ins only. The guard, key, verify and
// release steps run here in bash, with stand-ins for the Android build tools, unzip and gh.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

const workflowPath = new URL("../.github/workflows/fork-android-apk.yml", import.meta.url);
const tag = "fork-android-0.16.0-1";
const apk = "artifacts/paseo-fork-arm64.apk";

function readWorkflow() {
  return readFileSync(workflowPath, "utf8");
}

// The job's steps as { name, uses, with, env, run }. Reads this file's indentation (a step at 6
// spaces, its keys at 8, their values at 10), not YAML in general.
function readSteps(source) {
  const lines = source.split("\n");
  const start = lines.indexOf("    steps:");
  assert.notEqual(start, -1, "the job has steps");
  const items = [];
  for (const line of lines.slice(start + 1)) {
    if (line.startsWith("      - ")) items.push([`        ${line.slice(8)}`]);
    else if (line.trim() === "" || line.startsWith("        ")) items.at(-1).push(line);
    else if (!line.trimStart().startsWith("#")) break;
  }
  return items.map((item) => {
    const at = (key) => item.findIndex((line) => line.startsWith(`        ${key}:`));
    const head = (key) => (at(key) === -1 ? undefined : item[at(key)].slice(key.length + 9).trim());
    const body = (key) => {
      const values = [];
      for (const line of at(key) === -1 ? [] : item.slice(at(key) + 1)) {
        if (line.trim() !== "" && !line.startsWith("          ")) break;
        values.push(line.slice(10));
      }
      return values;
    };
    const mapping = (key) =>
      Object.fromEntries(
        body(key)
          .filter((line) => line.trim() !== "")
          .map((line) => {
            const colon = line.indexOf(":");
            return [
              line.slice(0, colon),
              line
                .slice(colon + 1)
                .trim()
                .replace(/^"(.*)"$/, "$1"),
            ];
          }),
      );
    return {
      name: head("name"),
      uses: head("uses"),
      with: mapping("with"),
      env: mapping("env"),
      run: head("run") === "|" ? `${body("run").join("\n").trimEnd()}\n` : head("run"),
    };
  });
}

function step(steps, name) {
  const found = steps.find((candidate) => candidate.name === name);
  assert.notEqual(found, undefined, `the workflow has a step "${name}"`);
  return found;
}

// GitHub runs `shell: bash` steps as `bash --noprofile --norc -eo pipefail {0}`.
function runStep(script, { env, cwd }) {
  return spawnSync("bash", ["--noprofile", "--norc", "-eo", "pipefail", "-c", script], {
    cwd,
    env: { PATH: process.env.PATH, ...env },
    encoding: "utf8",
  });
}

function scratch(t) {
  const dir = mkdtempSync(path.join(tmpdir(), "fork-android-apk-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// A stand-in tool: prints `out`, exits `code`, and appends its arguments to <file>.args.
function standIn(file, { out = "", code = 0 }) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(`${file}.out`, out);
  writeFileSync(file, `#!/bin/sh\necho "$*" >> "$0.args"\ncat "$0.out"\nexit ${code}\n`);
  chmodSync(file, 0o755);
}

test("runs only on a pushed fork-android-* tag, or by hand for an existing tag", () => {
  const source = readWorkflow();
  const on = source.match(/^on:\n((?:(?: {2}.*)?\n)*)/m)?.[1] ?? "";
  assert.deepEqual(
    [...on.matchAll(/^ {2}([a-z_]+):/gm)].map((match) => match[1]),
    ["push", "workflow_dispatch"],
    "no branch push, no pull_request, no schedule",
  );
  assert.equal(
    on.match(/^ {2}push:\n((?: {4}.*\n)*)/m)?.[1],
    '    tags:\n      - "fork-android-*"\n',
  );
  assert.match(
    on,
    /^ {2}workflow_dispatch:\n {4}inputs:\n {6}tag:\n(?: {8}.*\n)*? {8}required: true$/m,
  );
});

test("builds the tag it was started for, and refuses a tag that is not the fork's", (t) => {
  const source = readWorkflow();
  const steps = readSteps(source);
  assert.match(
    source,
    /^ {2}TAG: \$\{\{ github\.event_name == 'workflow_dispatch' && inputs\.tag \|\| github\.ref_name \}\}$/m,
  );
  const checkout = steps.find((candidate) => candidate.uses === "actions/checkout@v4");
  assert.deepEqual(checkout?.with, {
    ref: "refs/tags/${{ env.TAG }}",
    "persist-credentials": "false",
  });

  const guard = step(steps, "Refuse a tag that is not the fork's");
  assert.deepEqual(steps.slice(0, 2), [guard, checkout], "the guard runs before the checkout");
  const cwd = scratch(t);
  assert.equal(runStep(guard.run, { env: { TAG: tag }, cwd }).status, 0);
  for (const other of ["v0.16.0", "android-v0.16.0", "main"]) {
    const result = runStep(guard.run, { env: { TAG: other }, cwd });
    assert.equal(result.status, 1, other);
    assert.match(result.stdout, /::error::.*not a fork-android-\* tag/);
  }
});

test("builds with npm run build:apk:fork on ubuntu, Java 21 and build tools 35.0.0", () => {
  const source = readWorkflow();
  const steps = readSteps(source);
  assert.match(source, /^ {4}runs-on: ubuntu-latest$/m);
  assert.match(source, /^permissions:\n {2}contents: write\n/m);
  assert.match(source, /^ {2}ONNXRUNTIME_NODE_INSTALL: skip$/m);
  assert.deepEqual(
    steps.map((candidate) => candidate.name ?? candidate.uses),
    [
      "Refuse a tag that is not the fork's",
      "actions/checkout@v4",
      "actions/setup-node@v4",
      "actions/setup-java@v4",
      "android-actions/setup-android@v3",
      "Install build tools 35.0.0",
      "Install dependencies",
      "Write the fork's signing key",
      "Build the fork's APK",
      "Verify the APK",
      "Attach the APK to the tag's prerelease",
    ],
    "the key is written after npm ci and right before the build",
  );
  assert.deepEqual(steps[2].with, { "node-version-file": ".tool-versions", cache: "npm" });
  assert.deepEqual(steps[3].with, { distribution: "temurin", "java-version": "21" });
  assert.equal(step(steps, "Install build tools 35.0.0").run, 'sdkmanager "build-tools;35.0.0"');
  assert.equal(step(steps, "Install dependencies").run, "node scripts/npm-retry.mjs ci");
  assert.equal(step(steps, "Build the fork's APK").run, "npm run build:apk:fork");
});

test("the key reaches only its own step, as env, and goes to files without being printed", (t) => {
  const source = readWorkflow();
  const steps = readSteps(source);
  for (const [line] of source.matchAll(/^.*secrets\..*$/gm)) {
    assert.match(
      line,
      /^ {10}[A-Z_]+: \$\{\{ secrets\.[A-Z_]+ \}\}$/,
      "a secret is only a step's env value",
    );
  }
  assert.doesNotMatch(source, /set -[a-z]*x|xtrace/, "no command tracing");

  const key = step(steps, "Write the fork's signing key");
  assert.deepEqual(key.env, {
    FORK_ANDROID_KEYSTORE: "${{ secrets.FORK_ANDROID_KEYSTORE }}",
    FORK_ANDROID_KEYSTORE_PASSWORD: "${{ secrets.FORK_ANDROID_KEYSTORE_PASSWORD }}",
  });
  for (const other of steps.filter((candidate) => candidate !== key)) {
    assert.doesNotMatch(JSON.stringify(other), /FORK_ANDROID_KEYSTORE/, other.name ?? other.uses);
  }
  for (const line of key.run
    .split("\n")
    .filter((text) => /\$\{?FORK_ANDROID_KEYSTORE/.test(text))) {
    assert.doesNotMatch(line, /\b(echo|cat|tee)\b/, line);
    if (/\bprintf\b/.test(line)) {
      assert.match(line, /> "\$HOME\/\.paseo-fork\/release\.(keystore|password)"$/, line);
    }
  }

  const home = scratch(t);
  const keystore = randomBytes(2048);
  const password = "a-password-for-this-test-only";
  const encoded = keystore.toString("base64");
  const result = runStep(key.run, {
    env: { HOME: home, FORK_ANDROID_KEYSTORE: encoded, FORK_ANDROID_KEYSTORE_PASSWORD: password },
    cwd: home,
  });
  assert.equal(result.status, 0, result.stderr);
  const printed = result.stdout + result.stderr;
  assert.equal(printed.includes(password), false, "the password is not printed");
  assert.equal(printed.includes(encoded.slice(0, 40)), false, "the keystore is not printed");
  const dir = path.join(home, ".paseo-fork");
  assert.deepEqual(readFileSync(path.join(dir, "release.keystore")), keystore);
  assert.equal(readFileSync(path.join(dir, "release.password"), "utf8"), password);
  assert.equal(statSync(dir).mode & 0o777, 0o700);
  assert.equal(statSync(path.join(dir, "release.keystore")).mode & 0o777, 0o600);
  assert.equal(statSync(path.join(dir, "release.password")).mode & 0o777, 0o600);

  const empty = scratch(t);
  const missing = runStep(key.run, {
    env: { HOME: empty, FORK_ANDROID_KEYSTORE: "", FORK_ANDROID_KEYSTORE_PASSWORD: "" },
    cwd: empty,
  });
  assert.equal(missing.status, 1);
  assert.match(
    missing.stdout,
    /::error::.*FORK_ANDROID_KEYSTORE and FORK_ANDROID_KEYSTORE_PASSWORD/,
  );
});

const goodTools = {
  apksigner: {
    out: [
      "Verifies",
      "Verified using v2 scheme (APK Signature Scheme v2): true",
      "Number of signers: 1",
      "Signer #1 certificate DN: CN=Paseo Fork",
      "Signer #1 certificate SHA-256 digest: 5754f587",
      "",
    ].join("\n"),
  },
  aapt2: {
    out: [
      "package: name='sh.paseo.fork' versionCode='16000' versionName='0.16.0'",
      "application-label:'Paseo Fork'",
      "native-code: 'arm64-v8a'",
      "",
    ].join("\n"),
  },
  zipalign: { out: `Verifying alignment of ${apk} (4)...\nVerification succesful\n` },
  unzip: { out: "window.paseoFrame = frame;\n" },
};

function runVerify(t, script, overrides = {}) {
  const dir = scratch(t);
  const tools = { ...goodTools, ...overrides };
  const sdk = path.join(dir, "sdk");
  const buildTools = path.join(sdk, "build-tools/35.0.0");
  for (const name of ["apksigner", "aapt2", "zipalign"]) {
    standIn(path.join(buildTools, name), tools[name]);
  }
  standIn(path.join(dir, "bin/unzip"), tools.unzip);
  const work = path.join(dir, "work");
  mkdirSync(path.join(work, "artifacts"), { recursive: true });
  writeFileSync(path.join(work, apk), "an APK");
  mkdirSync(path.join(dir, "runner"));
  const result = runStep(script, {
    env: {
      PATH: `${path.join(dir, "bin")}:${process.env.PATH}`,
      ANDROID_HOME: sdk,
      RUNNER_TEMP: path.join(dir, "runner"),
    },
    cwd: work,
  });
  const args = (file) => readFileSync(`${file}.args`, "utf8");
  return { result, args, buildTools, bin: path.join(dir, "bin") };
}

test("the verify step passes the fork's signed, 16 KB aligned APK that carries ScriptFrame", (t) => {
  const verify = step(readSteps(readWorkflow()), "Verify the APK");
  const { result, args, buildTools, bin } = runVerify(t, verify.run);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(args(path.join(buildTools, "apksigner")), `verify --verbose --print-certs ${apk}\n`);
  assert.equal(args(path.join(buildTools, "aapt2")), `dump badging ${apk}\n`);
  assert.equal(args(path.join(buildTools, "zipalign")), `-c -P 16 -v 4 ${apk}\n`);
  assert.equal(args(path.join(bin, "unzip")), `-p ${apk} assets/index.android.bundle\n`);
});

test("the verify step fails the run on any mismatch", (t) => {
  const verify = step(readSteps(readWorkflow()), "Verify the APK");
  const badging = goodTools.aapt2.out;
  const cases = {
    "apksigner does not verify": { apksigner: { out: "DOES NOT VERIFY\n", code: 1 } },
    "another signer": {
      apksigner: {
        out: goodTools.apksigner.out.replace("CN=Paseo Fork", "CN=Android Debug,O=Android,C=US"),
      },
    },
    "the store package": { aapt2: { out: badging.replace("'sh.paseo.fork'", "'sh.paseo'") } },
    "the store label": { aapt2: { out: badging.replace("'Paseo Fork'", "'Paseo'") } },
    "more than arm64": { aapt2: { out: badging.replace("'arm64-v8a'", "'arm64-v8a' 'x86_64'") } },
    "not 16 KB aligned": { zipalign: { out: "Verification FAILED\n", code: 1 } },
    "no ScriptFrame in the bundle": { unzip: { out: "var other = 1;\n" } },
  };
  for (const [name, overrides] of Object.entries(cases)) {
    const { result } = runVerify(t, verify.run, overrides);
    assert.notEqual(result.status, 0, name);
    assert.match(result.stdout, /::error::/, name);
  }
});

test("attaches the APK to a prerelease named after the tag, made only when it is missing", (t) => {
  const source = readWorkflow();
  assert.doesNotMatch(
    source,
    /claude|anthropic|generated with|co-authored-by/i,
    "no AI attribution",
  );
  const release = step(readSteps(source), "Attach the APK to the tag's prerelease");
  assert.deepEqual(release.env, { GH_TOKEN: "${{ secrets.GITHUB_TOKEN }}" });

  const dir = scratch(t);
  const gh = path.join(dir, "bin/gh");
  mkdirSync(path.dirname(gh));
  writeFileSync(
    gh,
    "#!/usr/bin/env node\n" +
      'require("node:fs").appendFileSync(process.env.GH_LOG, JSON.stringify(process.argv.slice(2)) + "\\n");\n' +
      'if (process.argv[2] === "release" && process.argv[3] === "view") process.exit(Number(process.env.GH_VIEW));\n',
  );
  chmodSync(gh, 0o755);
  const calls = (view) => {
    const log = path.join(dir, `gh-${view}.log`);
    const result = runStep(release.run, {
      env: {
        PATH: `${path.dirname(gh)}:${process.env.PATH}`,
        TAG: tag,
        GITHUB_REPOSITORY: "allrested/paseo",
        GH_LOG: log,
        GH_VIEW: String(view),
      },
      cwd: dir,
    });
    assert.equal(result.status, 0, result.stderr);
    return readFileSync(log, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
  };
  const upload = ["release", "upload", tag, apk, "--repo", "allrested/paseo", "--clobber"];

  const [view, create, uploaded, ...rest] = calls(1);
  assert.deepEqual(view.slice(0, 3), ["release", "view", tag]);
  assert.deepEqual(create.slice(0, 3), ["release", "create", tag]);
  assert.deepEqual(
    create.filter((arg) => arg.startsWith("--") && arg !== "--notes" && arg !== "--title"),
    ["--repo", "--verify-tag", "--prerelease"],
  );
  assert.equal(create[create.indexOf("--title") + 1], `Paseo Fork ${tag}`);
  assert.match(create[create.indexOf("--notes") + 1], new RegExp(`sh\\.paseo\\.fork.*${tag}`));
  assert.deepEqual(uploaded, upload);
  assert.deepEqual(rest, []);

  assert.deepEqual(calls(0).slice(1), [upload], "an existing release only gets the APK again");
});
